const { debug: createDebug } = require('debug')
const {
  createS3ObjectKey,
  DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API,
  getLargeResponseHandlingConfiguration,
  getSignedUrlForS3Object,
  putBodyBufferInS3Object
} = require('../large-response-utils')

const { getRequestValuesFromEvent, getMultiValueHeaders } = require('../utils')

/**
 * It's important to note that version 1.0 events preserve the original request's headers keys case.
 */
function getOriginHeader (requestHeaders) {
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (key.toLowerCase() === 'origin') { return value }
  }
  return undefined
}

const getRequestValuesFromApiGatewayEvent = ({ event }) => getRequestValuesFromEvent({ event })

function getResponseToApiGateway ({
  statusCode,
  body,
  headers,
  isBase64Encoded,
  isBinaryBody,
  bodyBuffer,
  encodeBody
}) {
  const debug = createDebug('serverless-express::api-gateway-v1:getResponseToApiGateway')
  const multiValueHeaders = getMultiValueHeaders({ headers })
  const transferEncodingHeader = multiValueHeaders['transfer-encoding']

  // chunked transfer not currently supported by API Gateway
  if (transferEncodingHeader && transferEncodingHeader.includes('chunked')) {
    multiValueHeaders['transfer-encoding'] = transferEncodingHeader.filter(headerValue => headerValue !== 'chunked')
  }

  debug('typeof(isBinaryBody)=%s; typeof(bodyBuffer)=%s; Buffer.isBuffer(bodyBuffer)=%s',
    typeof (isBinaryBody), typeof (bodyBuffer), Buffer.isBuffer(bodyBuffer))

  if (bodyBuffer.length > DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API) {
    console.error(`[serverless-express::api-gateway-v1:getResponseToApiGateway] bodyBuffer.length (${bodyBuffer.length}) is greater than the S3 retrieval threshold (${DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API})`)
  }
  if (Buffer.isBuffer(body)) {
    debug('body is a buffer and its length is %d', body.length)
  } else if (typeof (body) === 'string') {
    debug('body is a string and its length is %d', body.length)
  } else {
    debug('body is a not a buffer. typeof(body)=%s', typeof (body))
  }
  return {
    statusCode,
    body: encodeBody(),
    multiValueHeaders,
    isBase64Encoded
  }
}

async function getResponseToApiGatewayAsync ({
  event,
  statusCode,
  body,
  headers,
  isBase64Encoded,
  isBinaryBody,
  bodyBuffer,
  encodeBody
}) {
  const debug = createDebug('serverless-express::api-gateway-v1:getResponseToApiGatewayAsync')
  const lrhConfiguration = getLargeResponseHandlingConfiguration()

  debug('typeof(isBinaryBody)=%s; typeof(bodyBuffer)=%s; Buffer.isBuffer(bodyBuffer)=%s',
    typeof (isBinaryBody), typeof (bodyBuffer), Buffer.isBuffer(bodyBuffer))

  let multiValueHeaders = getMultiValueHeaders({ headers })
  const transferEncodingHeader = multiValueHeaders['transfer-encoding']

  // chunked transfer not currently supported by API Gateway
  if (transferEncodingHeader && transferEncodingHeader.includes('chunked')) {
    multiValueHeaders['transfer-encoding'] = transferEncodingHeader.filter(headerValue => headerValue !== 'chunked')
  }

  if (lrhConfiguration === undefined && bodyBuffer.length > DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API) {
    console.error(`Large response handling is not configured and bodyBuffer.length (${bodyBuffer.length}) is greater than ${DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API}, so the response may fail to stream to the caller.`)
    body = encodeBody()
  } else if (lrhConfiguration !== undefined && bodyBuffer.length > lrhConfiguration.restApiLargeResponseThreshold) {
    debug('bodyBuffer.length (%d) is greater than the large response threshold (%d). S3 will be used as an intermediary for response retrieval.',
      bodyBuffer.length, lrhConfiguration.restApiLargeResponseThreshold)

    try {
      // Upload the object
      const objectKey = createS3ObjectKey()
      await putBodyBufferInS3Object(bodyBuffer, headers, objectKey)

      // Get a signed URL for retrieving the object (expires in 30 seconds)
      const signedUrl = await getSignedUrlForS3Object(objectKey)

      debug('Letting API Gateway know that the caller needs to retrieve the response from the signed URL.')
      // const requestHeaders = getRequestHeaders(event)
      const originHeader = getOriginHeader(event.headers)
      const corsHeaders = !originHeader ? {} : { 'Access-Control-Allow-Credentials': true, 'Access-Control-Allow-Origin': originHeader }

      statusCode = 303
      body = ''
      headers = {
        Location: signedUrl,
        ...corsHeaders
      }
      multiValueHeaders = getMultiValueHeaders({ headers })
      isBase64Encoded = false
    } catch (error) {
      console.error('Error:', error)
    }
  } else {
    debug('bodyBuffer.length (%d) is less than the large response size threshold.', bodyBuffer.length)
    body = encodeBody()
  }

  const result = {
    statusCode,
    body,
    multiValueHeaders,
    isBase64Encoded
  }

  debug('result: %o', result)
  return result
}

module.exports = {
  getRequest: getRequestValuesFromApiGatewayEvent,
  autoEncodeResponseBody: false,
  getResponse: getResponseToApiGateway,
  getResponseAsync: getResponseToApiGatewayAsync
}
