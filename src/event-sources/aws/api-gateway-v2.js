const { debug: createDebug } = require('debug')
const {
  createS3ObjectKey,
  DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API,
  getLargeResponseHandlingConfiguration,
  getSignedUrlForS3Object,
  putBodyBufferInS3Object
} = require('../large-response-utils')

const url = require('url')
const { getEventBody, getCommaDelimitedHeaders } = require('../utils')

/**
 * It's important to note that version 2.0 events guarantee the request headers' keys are lowercased.
 */
function getOriginHeaderValue (requestHeaders) {
  return requestHeaders.origin
}

/**
 * It's important to note that response headers are case insensitive.
 *
 * @returns undefined if no 'set-cookie' header is present; otherwise, an object with name and value fields that
 * provide the case-preserving name of the header and its value. This is important in case the caller wants to delete
 * the header after calling this function.
 */
function getSetCookieHeader (responseHeaders) {
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (name.toLowerCase() === 'set-cookie') { return { name, value } }
  }
  return undefined
}

function transferCookiesToApiGatewayResponse (headers, apiGatewayResponse) {
  const cookiesHeader = getSetCookieHeader(headers)
  if (cookiesHeader) {
    const cookieValue = cookiesHeader.value
    apiGatewayResponse.cookies = Array.isArray(cookieValue) ? cookieValue : [cookieValue]
    delete headers[cookiesHeader.name]
  }
}

function getRequestValuesFromApiGatewayEvent ({ event }) {
  const {
    requestContext,
    requestPath,
    rawPath,
    rawQueryString,
    cookies
  } = event
  const method = requestContext.http.method
  // Experimentation shows that:
  //  * requestPath is always undefined
  //  * rawPath is NOT URL encoded
  //  * rawQueryString IS URL encoded
  // express expects the path to be URL encoded.
  const requestPathOrRawPath = requestPath || rawPath
  const basePath = '' // TODO: Test with custom domain
  const stripBasePathRegex = new RegExp(`^${basePath}`)
  const path = url.format({
    pathname: encodeURI(requestPathOrRawPath).replace(stripBasePathRegex, ''),
    search: rawQueryString
  })

  const headers = {}

  if (cookies) {
    headers.cookie = cookies.join('; ')
  }

  Object.entries(event.headers).forEach(([headerKey, headerValue]) => {
    headers[headerKey.toLowerCase()] = headerValue
  })

  let body

  if (event.body) {
    body = getEventBody({ event })
    const isBase64Encoded = event.isBase64Encoded
    headers['content-length'] = Buffer.byteLength(body, isBase64Encoded ? 'base64' : 'utf8')
  }

  return {
    method,
    headers,
    body,
    remoteAddress: requestContext.http.sourceIp,
    path
  }
}

function getResponseToApiGateway ({
  statusCode,
  body,
  headers = {},
  isBase64Encoded = false,
  response = {},
  isBinaryBody = false,
  bodyBuffer,
  encodeBody
}) {
  const debug = createDebug('serverless-express::api-gateway-v2:getResponseToApiGateway')
  const transferEncodingHeader = headers['transfer-encoding']

  if (transferEncodingHeader === 'chunked' || response.chunkedEncoding) {
    const errorMsg = 'chunked encoding is not supported by API Gateway (event version 2.0)'
    console.error(errorMsg)
    throw new Error(errorMsg)
  }

  debug('typeof(isBinaryBody)=%s; typeof(bodyBuffer)=%s; Buffer.isBuffer(bodyBuffer)=%s',
    typeof (isBinaryBody), typeof (bodyBuffer), Buffer.isBuffer(bodyBuffer))

  if (bodyBuffer.length > DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API) {
    console.error(`[serverless-express::api-gateway-v2:getResponseToApiGateway] bodyBuffer.length (${bodyBuffer.length}) is greater than the S3 retrieval threshold (${DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API})`)
  }
  if (Buffer.isBuffer(body)) {
    debug('body is a buffer and its length is %d', body.length)
  } else if (typeof (body) === 'string') {
    debug('body is a string and its length is %d', body.length)
  } else {
    debug('body is a not a buffer. typeof(body)=%s', typeof (body))
  }

  const responseToApiGateway = {
    statusCode,
    body: encodeBody(),
    isBase64Encoded
  }

  transferCookiesToApiGatewayResponse(headers, responseToApiGateway)

  // The previous call can modify headers; that's why we set responseToApiGateway.headers here
  responseToApiGateway.headers = getCommaDelimitedHeaders({ headersMap: headers })

  return responseToApiGateway
}

async function getResponseToApiGatewayAsync ({
  event,
  statusCode,
  body,
  headers,
  isBase64Encoded,
  response = {},
  isBinaryBody,
  bodyBuffer,
  encodeBody
}) {
  const debug = createDebug('serverless-express::api-gateway-v2:getResponseToApiGatewayAsync')
  const transferEncodingHeader = headers['transfer-encoding']

  if (transferEncodingHeader === 'chunked' || response.chunkedEncoding) {
    const errorMsg = 'chunked encoding is not supported by API Gateway (event version 2.0)'
    console.error(errorMsg)
    throw new Error(errorMsg)
  }

  const statusDescriptionObject = {}
  const lrhConfiguration = getLargeResponseHandlingConfiguration()

  debug('typeof(isBinaryBody)=%s; typeof(bodyBuffer)=%s; Buffer.isBuffer(bodyBuffer)=%s',
    typeof (isBinaryBody), typeof (bodyBuffer), Buffer.isBuffer(bodyBuffer))

  if (lrhConfiguration === undefined && bodyBuffer.length > DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API) {
    console.error(`Large response handling is not configured and bodyBuffer.length (${bodyBuffer.length}) is greater than ${DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API}, so the response may fail to stream to the caller.`)
    body = encodeBody()
  } else if (lrhConfiguration !== undefined && bodyBuffer.length > lrhConfiguration.httpApiLargeResponseThreshold) {
    debug('bodyBuffer.length (%d) is greater than the large response threshold (%d). S3 will be used as an intermediary for response retrieval.',
      bodyBuffer.length, lrhConfiguration.httpApiLargeResponseThreshold)

    try {
      // Upload the object
      const objectKey = createS3ObjectKey()
      await putBodyBufferInS3Object(bodyBuffer, headers, objectKey)

      // Get a signed URL for retrieving the object (expires in 30 seconds)
      const signedUrl = await getSignedUrlForS3Object(objectKey)

      debug('Letting API Gateway know that the caller needs to retrieve the response from the signed URL.')
      const originHeader = getOriginHeaderValue(event.headers)
      const corsHeaders = !originHeader ? {} : { 'Access-Control-Allow-Credentials': true, 'Access-Control-Allow-Origin': originHeader }

      statusCode = 303
      statusDescriptionObject.statusDescription = 'Large response retrieval'
      body = ''
      headers = {
        Location: signedUrl,
        ...corsHeaders
      }
      isBase64Encoded = false
    } catch (error) {
      console.error('Error:', error)
    }
  } else {
    debug('bodyBuffer.length (%d) is less than the large response size threshold.', bodyBuffer.length)
    body = encodeBody()
  }

  const responseToApiGateway = {
    statusCode,
    ...statusDescriptionObject,
    body,
    isBase64Encoded
  }

  transferCookiesToApiGatewayResponse(headers, responseToApiGateway)

  // The previous call can modify headers; that's why we set responseToApiGateway.headers here
  responseToApiGateway.headers = getCommaDelimitedHeaders({ headersMap: headers })

  debug('responseToApiGateway: %o', responseToApiGateway)
  return responseToApiGateway
}

module.exports = {
  getRequest: getRequestValuesFromApiGatewayEvent,
  autoEncodeResponseBody: false,
  getResponse: getResponseToApiGateway,
  getResponseAsync: getResponseToApiGatewayAsync
}
