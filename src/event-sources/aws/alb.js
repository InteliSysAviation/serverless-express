const { debug: createDebug } = require('debug')
const {
  createS3ObjectKey,
  DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API,
  getLargeResponseHandlingConfiguration,
  getSignedUrlForS3Object,
  putBodyBufferInS3Object
} = require('../large-response-utils')

const url = require('url')
const { getEventBody, getMultiValueHeaders } = require('../utils')

// Overarching ALB notes and observations:
//   * Header names are always lowercased.
//   * Events coming from AWS Elastic Load Balancers do not automatically urldecode query parameters (unlike API Gateway).
//   * If the target group has multi-value headers enabled, multi-value querystring parameters are implicitly also
//     enabled. Each event.queryStringParameters entry consists of a querystring parameter name and a corresponding
//     array of values, even if there is only one corresponding value for the given querystring paramter.
//   * Empty headers (i.e. those with only a whitespace value) are not transmitted through to the lambda.

// Return a simple { [string]: string } object in the shape that would be expected for headers provided in a request
// to the Express application, given the incoming ELB event.
function getRequestHeaders (event) {
  let result = {}
  if (event.multiValueHeaders) {
    Object.entries(event.multiValueHeaders).forEach(([name, values]) => {
      let headerValues = ''
      for (let i = 0; i < values.length; i++) {
        headerValues += `${values[i]},`
      }
      if (values.length > 0) {
        headerValues = headerValues.slice(0, headerValues.length - 1) // remove trailing comma
      }
      result[name] = headerValues
    })
  } else {
    result = event.headers
  }
  return result
}

function getOriginHeader (requestHeaders) {
  // Since ALB request headers are always lowercase, the following is fine
  return requestHeaders.origin
}

// Return the remote address as indicated by the given ELB event. The remote address is provided in the ELB event
// via an x-forwarded-for HTTP header.
function getRemoteAddress (event) {
  let result
  if (event.multiValueHeaders) {
    const headerValues = event.multiValueHeaders['x-forwarded-for']
    if (Array.isArray(headerValues) && headerValues.length > 0) {
      result = headerValues[0]
    }
  } else {
    // ALB always lowercases header names
    if (event.headers && typeof event.headers['x-forwarded-for'] === 'string') {
      result = event.headers['x-forwarded-for']
    }
  }
  return result
}

// Express expects an incoming path that contains an querystring will all components encoded. An ELB event does
// not decode the querystring names or values so those can just be used directly to produce the full querystring.
function constructRawQueryString (event) {
  let result = ''
  if (event.multiValueQueryStringParameters) {
    Object.entries(event.multiValueQueryStringParameters).forEach(([name, values]) => {
      for (let i = 0; i < values.length; i++) {
        result += `${name}=${values[i]}&`
      }
    })
    if (result.length > 0) {
      result = result.slice(0, result.length - 1) // remove trailing ampersand
    }
  } else {
    Object.entries(event.queryStringParameters).forEach(([name, value]) => {
      result += `${name}=${value}&`
    })
    if (result.length > 0) {
      result = result.slice(0, result.length - 1) // remove trailing ampersand
    }
  }
  return result
}

// Completely changing the implementation of this based on the observed shape of an event coming from ELB.
// Events coming from AWS Elastic Load Balancers do not automatically urldecode query parameters (unlike API Gateway).
const getRequestValuesFromAlbEvent = ({ event }) => {
  const headers = getRequestHeaders(event)

  // ALB event always appears to have a body
  // The toString on the content-length is to make it identical to how it comes in from the APIGW
  const body = getEventBody({ event })
  headers['content-length'] = Buffer.byteLength(body, event.isBase64Encoded ? 'base64' : 'utf8')

  return {
    method: event.httpMethod,
    headers,
    body,
    remoteAddress: getRemoteAddress(event),
    path: url.format({
      // Experimentation shows that that event.path when originating from ELB is already URL encoded (which express expects)
      pathname: event.path,
      search: constructRawQueryString(event)
    })
  }
}

const getResponseToAlb = ({
  statusCode,
  body,
  headers,
  isBase64Encoded,
  isBinaryBody,
  bodyBuffer,
  encodeBody
}) => {
  const debug = createDebug('serverless-express::alb:getResponseToAlb')
  const multiValueHeaders = getMultiValueHeaders({ headers })

  debug('typeof(isBinaryBody)=%s; typeof(bodyBuffer)=%s; Buffer.isBuffer(bodyBuffer)=%s',
    typeof (isBinaryBody), typeof (bodyBuffer), Buffer.isBuffer(bodyBuffer))

  if (bodyBuffer.length > DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API) {
    console.error(`bodyBuffer.length (${bodyBuffer.length}) is greater than the S3 retrieval threshold (${DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API})`)
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

async function getResponseToAlbAsync ({
  event,
  statusCode,
  body,
  headers,
  isBase64Encoded,
  isBinaryBody,
  bodyBuffer,
  encodeBody
}) {
  const debug = createDebug('serverless-express::alb:getResponseToAlbAsync')
  const statusDescriptionObject = {}
  const lrhConfiguration = getLargeResponseHandlingConfiguration()

  debug('typeof(isBinaryBody)=%s; typeof(bodyBuffer)=%s; Buffer.isBuffer(bodyBuffer)=%s',
    typeof (isBinaryBody), typeof (bodyBuffer), Buffer.isBuffer(bodyBuffer))

  if (lrhConfiguration === undefined && bodyBuffer.length > DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API) {
    console.error(`Large response handling is not configured and bodyBuffer.length (${bodyBuffer.length}) is greater than ${DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API}, so the response may fail to stream to the caller.`)
    body = encodeBody()
  } else if (lrhConfiguration !== undefined && bodyBuffer.length > lrhConfiguration.albApiLargeResponseThreshold) {
    debug('bodyBuffer.length (%d) is greater than the large response threshold (%d). S3 will be used as an intermediary for response retrieval.',
      bodyBuffer.length, lrhConfiguration.albApiLargeResponseThreshold)

    try {
      // Upload the object
      const objectKey = createS3ObjectKey()
      await putBodyBufferInS3Object(bodyBuffer, headers, objectKey)

      // Get a signed URL for retrieving the object
      const signedUrl = await getSignedUrlForS3Object(objectKey)

      debug('Letting ALB know that the caller needs to retrieve the response from the signed URL.')
      const requestHeaders = getRequestHeaders(event)
      const originHeader = getOriginHeader(requestHeaders)
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

  const multiValueHeaders = getMultiValueHeaders({ headers })
  const result = {
    statusCode,
    ...statusDescriptionObject,
    body,
    multiValueHeaders,
    isBase64Encoded
  }
  debug('result: %o', result)
  return result
}

module.exports = {
  getRequest: getRequestValuesFromAlbEvent,
  autoEncodeResponseBody: false,
  getResponse: getResponseToAlb,
  getResponseAsync: getResponseToAlbAsync
}
