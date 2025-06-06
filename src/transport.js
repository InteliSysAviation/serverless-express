const util = require('util')
const ServerlessRequest = require('./request')
const ServerlessResponse = require('./response')
const { getEventSource } = require('./event-sources')
const Response = require('./response')
const isBinary = require('./is-binary')
const { debug: createDebug } = require('debug')

async function forwardResponse ({
  binarySettings,
  response,
  resolver,
  eventSource,
  event,
  log
}) {
  const debug = createDebug('serverless-express::transport:forwardResponse')
  const statusCode = response.statusCode
  const headers = Response.headers(response)
  const isBinaryBody = isBinary({
    headers,
    binarySettings
  })
  const isBase64Encoded = isBinaryBody
  const encoding = isBase64Encoded ? 'base64' : 'utf8'
  const bodyBuffer = Response.body(response)
  debug('bodyBuffer.length: (%s); isBase64Encoded: %s', bodyBuffer.length, isBase64Encoded)
  let body
  let logBody
  let encodeBody
  if (typeof (eventSource.autoEncodeResponseBody) === 'boolean' && !eventSource.autoEncodeResponseBody) {
    debug('eventSource.autoEncodeResponseBody is explicitly %s, so the body will not be automatically encoded. The eventSource getResponse/getResponseAsync will have to work with the bodyBuffer or use the encodeBody function passed to them to get an appropriate body.', eventSource.autoEncodeResponseBody)
    encodeBody = () => Response.body(response).toString(encoding)
    logBody = '[ENCODING DEFERRED]'
  } else {
    body = Response.body(response).toString(encoding)
    logBody = isBase64Encoded ? '[BASE64_ENCODED]' : body
  }

  log.debug('SERVERLESS_EXPRESS:FORWARD_RESPONSE:EVENT_SOURCE_RESPONSE_PARAMS', {
    statusCode,
    body: logBody,
    headers,
    isBase64Encoded,
    isBinaryBody, // Semantically more meaningful than implicit indication via isBase64Encoded
    bodyBuffer // So the getResponse eventSource handler can deal with the raw data directly
  })

  let successResponse

  if (typeof (eventSource.getResponseAsync) === 'function') {
    debug('eventSource.getResponseAsync is a function, so asynchronous invokation will be used')

    successResponse = await eventSource.getResponseAsync({
      event,
      statusCode,
      body,
      headers,
      isBase64Encoded,
      response,
      isBinaryBody, // Semantically more meaningful than implicit indication via isBase64Encoded
      bodyBuffer, // So the getResponse eventSource handler can deal with the raw data directly
      encodeBody
    })
  } else {
    debug('eventSource.getResponseAsync is not a function, so synchronous invokation will be used')

    successResponse = eventSource.getResponse({
      event,
      statusCode,
      body,
      headers,
      isBase64Encoded,
      response,
      isBinaryBody, // Semantically more meaningful than implicit indication via isBase64Encoded
      bodyBuffer, // So the getResponse eventSource handler can deal with the raw data directly
      encodeBody
    })
  }

  log.debug('SERVERLESS_EXPRESS:FORWARD_RESPONSE:EVENT_SOURCE_RESPONSE', () => ({
    successResponse: util.inspect(successResponse, { depth: null }),
    ...(!body ? { body: '' } : { body: logBody })
  }))

  resolver.succeed({
    response: successResponse
  })
}

function respondToEventSourceWithError ({
  error,
  resolver,
  log,
  respondWithErrors,
  eventSourceName,
  eventSource
}) {
  log.error('SERVERLESS_EXPRESS:RESPOND_TO_EVENT_SOURCE_WITH_ERROR', error)

  if (
    eventSourceName !== 'AWS_ALB' &&
    eventSourceName !== 'AWS_LAMBDA_EDGE' &&
    eventSourceName !== 'AWS_API_GATEWAY_V1' &&
    eventSourceName !== 'AWS_API_GATEWAY_V2' &&
    eventSourceName !== 'AZURE_HTTP_FUNCTION_V3' &&
    eventSourceName !== 'AZURE_HTTP_FUNCTION_V4'
  ) {
    resolver.fail({ error })
    return
  }

  const body = respondWithErrors ? error.stack : ''
  const bodyBuffer = Buffer.from(body ?? '')
  const errorResponse = eventSource.getResponse({
    statusCode: 500,
    body,
    headers: {},
    isBase64Encoded: false,
    isBinaryBody: false,
    bodyBuffer,
    encodeBody: () => body
  })

  resolver.succeed({ response: errorResponse })
}

async function getRequestResponse ({
  method,
  headers,
  body,
  remoteAddress,
  path
}) {
  const request = new ServerlessRequest({
    method,
    headers,
    body,
    remoteAddress,
    url: path
  })
  await waitForStreamComplete(request)

  const response = new ServerlessResponse(request)

  return { request, response }
}

function markHttpRequestAsCompleted (request) {
  request.complete = true
  request.readable = false
}

function waitForStreamComplete (stream) {
  if (stream.complete || stream.writableEnded) {
    return stream
  }

  return new Promise((resolve, reject) => {
    stream.once('error', complete)
    stream.once('end', complete)
    stream.once('finish', complete)

    let isComplete = false

    function complete (err) {
      if (isComplete) {
        return
      }

      isComplete = true

      stream.removeListener('error', complete)
      stream.removeListener('end', complete)
      stream.removeListener('finish', complete)

      if (err) {
        reject(err)
      } else {
        resolve(stream)
      }
    }
  })
}

async function forwardRequestToNodeServer ({
  app,
  framework,
  event,
  context,
  resolver,
  eventSourceName,
  binarySettings,
  eventSource = getEventSource({ eventSourceName }),
  eventSourceRoutes,
  log
}) {
  const requestValues = eventSource.getRequest({ event, context, log })

  if (!requestValues.path && eventSourceRoutes[eventSourceName]) {
    requestValues.path = eventSourceRoutes[eventSourceName]
  }

  log.debug('SERVERLESS_EXPRESS:FORWARD_REQUEST_TO_NODE_SERVER:REQUEST_VALUES', { requestValues })
  const { request, response } = await getRequestResponse(requestValues)
  await framework.sendRequest({ app, request, response })
  markHttpRequestAsCompleted(request)
  await waitForStreamComplete(response)
  log.debug('SERVERLESS_EXPRESS:FORWARD_REQUEST_TO_NODE_SERVER:RESPONSE', { response })
  await forwardResponse({
    binarySettings,
    response,
    resolver,
    eventSource,
    event,
    log
  })
  return response
}

module.exports = {
  forwardResponse,
  respondToEventSourceWithError,
  forwardRequestToNodeServer,
  getRequestResponse
}
