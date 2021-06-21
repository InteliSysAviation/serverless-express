const url = require('url')
const { getEventBody, getMultiValueHeaders } = require('../utils')

// Overarching ALB notes and observations:
//   * Header names are always lowercased.
//   * Events coming from AWS Elastic Load Balancers do not automatically urldecode query parameters (unlike API Gateway).
//   * If the target group has multi-value headers enabled, multi-value querystring parameters are implicitly also
//     enabled. Each event.queryStringParameters entry consists of a querystring parameter name and a corresponding
//     array of values, even if there is only one corresponding value for the given querystring paramter.
//   * Empty headers (i.e. those with only a whitespace value) are not transmitted through to the lambda.

// It is assumed that the path argument does not have a querystring
function urlDecodePath (path) {
  const pathSeperator = '/'
  const pathComponents = path.split(pathSeperator)
  let decodedPath = ''
  for (let i = 0; i < pathComponents.length; i++) {
    decodedPath += decodeURIComponent(pathComponents[i]) + pathSeperator
  }
  return pathComponents.length > 0 ? decodedPath.slice(0, decodedPath.length - 1) : ''
}

// Return an simple { [string]: string } object in the shape that would be expected for headers provided in a request
// to the Express application, given the incoming ELB event.
function getHeaders (event) {
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
// So we need to check for that and automatically decode them to normalize the request between the two.
// In addition, the path appears to be URL encoded.
const getRequestValuesFromAlbEvent = ({ event }) => {
  const headers = getHeaders(event)

  // ALB event always appears to have a body
  // The toString on the content-length is to make it identical to how it comes in from the APIGW
  const body = getEventBody({ event })
  headers['content-length'] = Buffer.byteLength(body, event.isBase64Encoded ? 'base64' : 'utf8')

  return {
    method: event.httpMethod,
    headers: headers,
    body: body,
    remoteAddress: getRemoteAddress(event),
    path: url.format({
      pathname: urlDecodePath(event.path),
      search: constructRawQueryString(event)
    })
  }
}

const getResponseToAlb = ({
  statusCode,
  body,
  headers,
  isBase64Encoded
}) => {
  const multiValueHeaders = getMultiValueHeaders({ headers })

  return {
    statusCode,
    body,
    multiValueHeaders,
    isBase64Encoded
  }
}

module.exports = {
  getRequest: getRequestValuesFromAlbEvent,
  getResponse: getResponseToAlb,

  // The following are really private to this module, but are exported to permit jest testability
  private: {
    urlDecodePath: urlDecodePath,
    getHeaders: getHeaders,
    getRemoteAddress: getRemoteAddress,
    constructRawQueryString: constructRawQueryString,
  },
}
