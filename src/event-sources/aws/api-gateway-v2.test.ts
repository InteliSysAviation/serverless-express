const utils = require("../utils");
const awsAPIGW_V2EventSource = require('./api-gateway-v2');

/**
 * The following sample events were based on a hypothetical form input with the following shape:
 * 
	<form action="https://albhostname.company.tld/pp¥pp" method="get">
		<input type="text" name="test¥Param" value="Hello World: ¥" />
		<input type="hidden" name="multi¥Value" value="red ¥ apple" />
		<input type="hidden" name="multi¥Value" value="red, green" />
		<input type="submit" />
	</form>
 *
 * The actual HTTP requests were performed with Postman to prevent browser-specific headers from
 * being submitted. In addition to the above form data, two values for a multivalue header named
 * 'x-multivalue-header' were sumitted to capture how that translates into the ALB event. Here are
 * the two values submitted for for this header: ['veg,pea' 'veg,celery']. The comma was deliberately
 * used in each of these to see how the ELB dealt with it.
 *
 * Some important characteristics that were being exercised here are:
 *   - the URL contains non-ascii unicode characters
 *   - the form parameter names and values contain non-ascii unicode characters
 *   - there is a multi-value form parameter
 *   - there is a multi-value header
 * 
 * As described https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html,
 * payload format version 2.0 "doesn't have multiValueHeaders or multiValueQueryStringParameters fields." This is a bit
 * unfortunate when trying straight-up comparisons of incoming HTTP request payloads against corresponding request
 * payloads coming from ELB. Even still, it's interesting to compare the shapes of the events.
 */

/**
This is an event captured from an APIGW v2 event source.
*/
const apigw_v2_get_event = {
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/pp¥pp",
  "rawQueryString": "test%C2%A5Param=Hello+World%3A+%C2%A5&multi%C2%A5Value=red+%C2%A5+apple&multi%C2%A5Value=red%2C+green",
  "headers": {
      "accept": "*/*",
      "accept-encoding": "gzip, deflate, br",
      "content-length": "0",
      "host": "bt7m13f3w5.execute-api.ap-southeast-1.amazonaws.com",
      "postman-token": "0fe5c062-74d7-426d-ba44-7e66df5c3304",
      "user-agent": "PostmanRuntime/7.28.0",
      "x-amzn-trace-id": "Root=1-60c8ac5e-4ccf9b3a0ad28c2532890dbb",
      "x-forwarded-for": "14.186.90.46",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-multivalue-header": "veg,pea,veg,celery"
  },
  "queryStringParameters": {
      "multi¥Value": "red ¥ apple,red, green",
      "test¥Param": "Hello World: ¥"
  },
  "requestContext": {
      "accountId": "880230544159",
      "apiId": "bt7m13f3w5",
      "domainName": "bt7m13f3w5.execute-api.ap-southeast-1.amazonaws.com",
      "domainPrefix": "bt7m13f3w5",
      "http": {
          "method": "GET",
          "path": "/pp¥pp",
          "protocol": "HTTP/1.1",
          "sourceIp": "14.186.90.46",
          "userAgent": "PostmanRuntime/7.28.0"
      },
      "requestId": "A9_e0gDbSQ0EMJw=",
      "routeKey": "$default",
      "stage": "$default",
      "time": "15/Jun/2021:13:34:22 +0000",
      "timeEpoch": 1623764062693
  },
  "isBase64Encoded": false
};

/**
This is an event captured from an APIGW v2 event source.
*/
const apigw_v2_post_event = {
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/pp¥pp",
  "rawQueryString": "",
  "headers": {
      "accept": "*/*",
      "accept-encoding": "gzip, deflate, br",
      "content-length": "425",
      "content-type": "multipart/form-data; boundary=--------------------------574369647586031065022315",
      "host": "bt7m13f3w5.execute-api.ap-southeast-1.amazonaws.com",
      "postman-token": "52453ce8-9083-4065-be23-e78765ce70b7",
      "user-agent": "PostmanRuntime/7.28.0",
      "x-amzn-trace-id": "Root=1-60c8aa0c-000c102d136360281b9c394a",
      "x-forwarded-for": "14.186.90.46",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-multivalue-header": "veg,pea,veg,celery"
  },
  "requestContext": {
      "accountId": "880230544159",
      "apiId": "bt7m13f3w5",
      "domainName": "bt7m13f3w5.execute-api.ap-southeast-1.amazonaws.com",
      "domainPrefix": "bt7m13f3w5",
      "http": {
          "method": "POST",
          "path": "/pp¥pp",
          "protocol": "HTTP/1.1",
          "sourceIp": "14.186.90.46",
          "userAgent": "PostmanRuntime/7.28.0"
      },
      "requestId": "A9-B6hkPSQ0EMJw=",
      "routeKey": "$default",
      "stage": "$default",
      "time": "15/Jun/2021:13:24:28 +0000",
      "timeEpoch": 1623763468095
  },
  "body": "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLTU3NDM2OTY0NzU4NjAzMTA2NTAyMjMxNQ0KQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPSJ0ZXN0wqVQYXJhbSINCg0KSGVsbG8gV29ybGQ6IMKlDQotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tNTc0MzY5NjQ3NTg2MDMxMDY1MDIyMzE1DQpDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9Im11bHRpwqVWYWx1ZSINCg0KcmVkIMKlIGFwcGxlDQotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tNTc0MzY5NjQ3NTg2MDMxMDY1MDIyMzE1DQpDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9Im11bHRpwqVWYWx1ZSINCg0KcmVkLCBncmVlbg0KLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLTU3NDM2OTY0NzU4NjAzMTA2NTAyMjMxNS0tDQo=",
  "isBase64Encoded": true
};

describe("getEventSourceNameBasedOnEvent", () => {
  test("recognizes APIGW v2 event for GET HTTP request", () => {
    const result = utils.getEventSourceNameBasedOnEvent({ event: apigw_v2_get_event });
    expect(result).toEqual("AWS_API_GATEWAY_V2");
  });
  test("recognizes APIGW v2 event for POST HTTP request", () => {
    const result = utils.getEventSourceNameBasedOnEvent({ event: apigw_v2_post_event });
    expect(result).toEqual("AWS_API_GATEWAY_V2");
  });
});

describe("getRequestValuesFromApiGatewayEvent", () => {
  test.skip("APIGW v2 event for GET HTTP request", () => {
    const result = awsAPIGW_V2EventSource.getRequestValuesFromApiGatewayEvent({ event: apigw_v2_get_event });
    expect(result).toEqual({}); // TBD
  });
  test.skip("APIGW v2 event for POST HTTP request", () => {
    const result = awsAPIGW_V2EventSource.getRequestValuesFromApiGatewayEvent({ event: apigw_v2_post_event });
    expect(result).toEqual({}); // TBD
  });
});

describe("getResponseToApiGateway", () => {
  test.skip("from an APIGW v2 event with a successful outcome", () => {
    // TODO come up with a simple 'successResponse' to feed to getResponseToApiGateway and validate against the
    // expected result
    const successExpressResponse = {};
    const expectedApiGatewayResponse = {};
    const result = awsAPIGW_V2EventSource.getResponseToApiGateway(successExpressResponse);
    expect(result).toEqual(expectedApiGatewayResponse);
  });
  test.skip("from an APIGW v2 event with an error outcome", () => {
    // TODO come up with a simple 'errorResponse' to feed to getResponseToApiGateway and validate against the
    // expected result
    const errorExpressResponse = {};
    const expectedApiGatewayResponse = {};
    const result = awsAPIGW_V2EventSource.getResponseToApiGateway(errorExpressResponse);
    expect(result).toEqual(expectedApiGatewayResponse);
  });
});

module.exports = {
  apigw_v2_get_event,
  apigw_v2_post_event,
};
