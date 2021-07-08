const utils = require("../utils");
const awsAlbEventSource = require('./alb');

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
 */

/**
This is an event captured from an ELB event source. Specifically, this was captured from a target group
forwarding a GET HTTP request to a lambda function with the "Multi value headers" attribute NOT enabled.
Some interesting observations:
  - only one of the multi-value parameter values is forwarded by the ELB to the lambda event
  - only one of the multi-value header values is forwarded by the ELB to the lambda event
*/
const alb_get_without_mvh_event = {
  "requestContext": {
      "elb": {
          "targetGroupArn": "arn:aws:elasticloadbalancing:ap-southeast-1:880230544159:targetgroup/lambda-echoevent-tg/09a2a46d2acfba96"
      }
  },
  "httpMethod": "GET",
  "path": "/pp%C2%A5pp",
  "queryStringParameters": {
      "multi%C2%A5Value": "red%2C+green",
      "test%C2%A5Param": "Hello+World%3A+%C2%A5"
  },
  "headers": {
      "accept": "*/*",
      "accept-encoding": "gzip, deflate, br",
      "connection": "keep-alive",
      "host": "echoevent.intelisysqa.ca",
      "postman-token": "0ca3fb83-0b91-4e47-bb03-359746d144b4",
      "user-agent": "PostmanRuntime/7.28.0",
      "x-amzn-trace-id": "Root=1-60c06484-136f10932a9d72ea34407239",
      "x-forwarded-for": "14.169.54.234",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-multivalue-header": "veg,celery"
  },
  "body": "",
  "isBase64Encoded": false
};

/**
This is an event captured from an ELB event source. Specifically, this was captured from a target group
forwarding a GET HTTP request to a lambda function with the "Multi value headers" attribute NOT enabled.
*/
const alb_get_with_mvh_event = {
  "requestContext": {
    "elb": {
      "targetGroupArn": "arn:aws:elasticloadbalancing:ap-southeast-1:880230544159:targetgroup/lambda-echoevent-tg/09a2a46d2acfba96"
    }
  },
  "httpMethod": "GET",
  "path": "/pp%C2%A5pp",
  "multiValueQueryStringParameters": {
    "multi%C2%A5Value": [
      "red+%C2%A5+apple",
      "red%2C+green"
    ],
    "test%C2%A5Param": [
      "Hello+World%3A+%C2%A5"
    ]
  },
  "multiValueHeaders": {
    "accept": [
      "*/*"
    ],
    "accept-encoding": [
      "gzip, deflate, br"
    ],
    "connection": [
      "keep-alive"
    ],
    "host": [
      "echoevent.intelisysqa.ca"
    ],
    "postman-token": [
      "f1231e8c-4929-4b91-b8b7-a818a4b1a98a"
    ],
    "user-agent": [
      "PostmanRuntime/7.28.0"
    ],
    "x-amzn-trace-id": [
      "Root=1-60c0630d-67397f4609b8e19d5ca10427"
    ],
    "x-forwarded-for": [
      "14.169.54.234"
    ],
    "x-forwarded-port": [
      "443"
    ],
    "x-forwarded-proto": [
      "https"
    ],
    "x-multivalue-header": [
      "veg,pea",
      "veg,celery"
    ]
  },
  "body": "",
  "isBase64Encoded": false
};

/**
This is an event captured from an ELB event source. Specifically, this was captured from a target group
forwarding a GET HTTP request to a lambda function with the "Multi value headers" attribute NOT enabled.
Some interesting observations:
  - only one of the multi-value header values is forwarded by the ELB to the lambda event
*/
const alb_post_without_mvh_event = {
  "requestContext": {
      "elb": {
          "targetGroupArn": "arn:aws:elasticloadbalancing:ap-southeast-1:880230544159:targetgroup/lambda-echoevent-tg/09a2a46d2acfba96"
      }
  },
  "httpMethod": "POST",
  "path": "/pp%C2%A5pp",
  "queryStringParameters": {},
  "headers": {
      "accept": "*/*",
      "accept-encoding": "gzip, deflate, br",
      "connection": "keep-alive",
      "content-length": "425",
      "content-type": "multipart/form-data; boundary=--------------------------053813846626992301385195",
      "host": "echoevent.intelisysqa.ca",
      "postman-token": "49429809-039d-4171-a920-db2f04feb390",
      "user-agent": "PostmanRuntime/7.28.0",
      "x-amzn-trace-id": "Root=1-60c06465-2549927316296af552839b7d",
      "x-forwarded-for": "14.169.54.234",
      "x-forwarded-port": "443",
      "x-forwarded-proto": "https",
      "x-multivalue-header": "veg,celery"
  },
  "body": "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLTA1MzgxMzg0NjYyNjk5MjMwMTM4NTE5NQ0KQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPSJ0ZXN0wqVQYXJhbSINCg0KSGVsbG8gV29ybGQ6IMKlDQotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tMDUzODEzODQ2NjI2OTkyMzAxMzg1MTk1DQpDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9Im11bHRpwqVWYWx1ZSINCg0KcmVkIMKlIGFwcGxlDQotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tMDUzODEzODQ2NjI2OTkyMzAxMzg1MTk1DQpDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9Im11bHRpwqVWYWx1ZSINCg0KcmVkLCBncmVlbg0KLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLTA1MzgxMzg0NjYyNjk5MjMwMTM4NTE5NS0tDQo=",
  "isBase64Encoded": true
};

/**
This is an event captured from an ELB event source. Specifically, this was captured from a target group
forwarding a POST HTTP request to a lambda function with the "Multi value headers" attribute NOT enabled.
*/
const alb_post_with_mvh_event = {
  "requestContext": {
    "elb": {
      "targetGroupArn": "arn:aws:elasticloadbalancing:ap-southeast-1:880230544159:targetgroup/lambda-echoevent-tg/09a2a46d2acfba96"
    }
  },
  "httpMethod": "POST",
  "path": "/pp%C2%A5pp",
  "multiValueQueryStringParameters": {},
  "multiValueHeaders": {
    "accept": [
      "*/*"
    ],
    "accept-encoding": [
      "gzip, deflate, br"
    ],
    "connection": [
      "keep-alive"
    ],
    "content-length": [
      "425"
    ],
    "content-type": [
      "multipart/form-data; boundary=--------------------------790755205523996327761243"
    ],
    "host": [
      "echoevent.intelisysqa.ca"
    ],
    "postman-token": [
      "da3ce04c-d67c-44a6-b707-c83755334b1d"
    ],
    "user-agent": [
      "PostmanRuntime/7.28.0"
    ],
    "x-amzn-trace-id": [
      "Root=1-60c063d6-338c9f07762d7142793c4ae5"
    ],
    "x-forwarded-for": [
      "14.169.54.234"
    ],
    "x-forwarded-port": [
      "443"
    ],
    "x-forwarded-proto": [
      "https"
    ],
    "x-multivalue-header": [
      "veg,pea",
      "veg,celery"
    ]
  },
  "body": "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLTc5MDc1NTIwNTUyMzk5NjMyNzc2MTI0Mw0KQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPSJ0ZXN0wqVQYXJhbSINCg0KSGVsbG8gV29ybGQ6IMKlDQotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tNzkwNzU1MjA1NTIzOTk2MzI3NzYxMjQzDQpDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9Im11bHRpwqVWYWx1ZSINCg0KcmVkIMKlIGFwcGxlDQotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tNzkwNzU1MjA1NTIzOTk2MzI3NzYxMjQzDQpDb250ZW50LURpc3Bvc2l0aW9uOiBmb3JtLWRhdGE7IG5hbWU9Im11bHRpwqVWYWx1ZSINCg0KcmVkLCBncmVlbg0KLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLTc5MDc1NTIwNTUyMzk5NjMyNzc2MTI0My0tDQo=",
  "isBase64Encoded": true
};

describe("getEventSourceNameBasedOnEvent", () => {
  test("recognizes ELB event for GET HTTP request without multi value headers enabled", () => {
    const result = utils.getEventSourceNameBasedOnEvent({ event: alb_get_without_mvh_event });
    expect(result).toEqual("AWS_ALB");
  });
  test("recognizes ELB event for POST HTTP request without multi value headers enabled", () => {
    const result = utils.getEventSourceNameBasedOnEvent({ event: alb_post_without_mvh_event });
    expect(result).toEqual("AWS_ALB");
  });
  test("recognizes ELB event for GET HTTP request without multi value headers enabled", () => {
    const result = utils.getEventSourceNameBasedOnEvent({ event: alb_get_with_mvh_event });
    expect(result).toEqual("AWS_ALB");
  });
  test("recognizes ELB event for POST HTTP request without multi value headers enabled", () => {
    const result = utils.getEventSourceNameBasedOnEvent({ event: alb_post_with_mvh_event });
    expect(result).toEqual("AWS_ALB");
  });
});

describe("getHeaders", () => {
  test("from an ELB event with multi value headers disabled", () => {
    const result = awsAlbEventSource.private.getHeaders(alb_get_without_mvh_event);
    expect(result).toEqual({
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br",
        "connection": "keep-alive",
        "host": "echoevent.intelisysqa.ca",
        "postman-token": "0ca3fb83-0b91-4e47-bb03-359746d144b4",
        "user-agent": "PostmanRuntime/7.28.0",
        "x-amzn-trace-id": "Root=1-60c06484-136f10932a9d72ea34407239",
        "x-forwarded-for": "14.169.54.234",
        "x-forwarded-port": "443",
        "x-forwarded-proto": "https",
        "x-multivalue-header": "veg,celery"
    });
  });
  test("from an ELB event with multi value headers enabled", () => {
    const result = awsAlbEventSource.private.getHeaders(alb_get_with_mvh_event);
    expect(result).toEqual({
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br",
        "connection": "keep-alive",
        "host": "echoevent.intelisysqa.ca",
        "postman-token": "f1231e8c-4929-4b91-b8b7-a818a4b1a98a",
        "user-agent": "PostmanRuntime/7.28.0",
        "x-amzn-trace-id": "Root=1-60c0630d-67397f4609b8e19d5ca10427",
        "x-forwarded-for": "14.169.54.234",
        "x-forwarded-port": "443",
        "x-forwarded-proto": "https",
        "x-multivalue-header": "veg,pea,veg,celery"
    });
  });
});

describe("getRemoteAddress", () => {
  test("from an ELB event with multi value headers disabled", () => {
    const result = awsAlbEventSource.private.getRemoteAddress(alb_get_without_mvh_event);
    expect(result).toBe("14.169.54.234");
  });
  test("from an ELB event with multi value headers enabled", () => {
    const result = awsAlbEventSource.private.getRemoteAddress(alb_get_with_mvh_event);
    expect(result).toBe("14.169.54.234");
  });
});

describe("constructRawQueryString", () => {
  test("from an ELB event with multi value headers disabled and no querystring parameters", () => {
    const event = {
      ...alb_get_without_mvh_event,
      ...{
        queryStringParameters: {}
      }
    };
    const result = awsAlbEventSource.private.constructRawQueryString(event);
    expect(result).toBe("");
  });
  test("from an ELB event with multi value headers disabled", () => {
    const result = awsAlbEventSource.private.constructRawQueryString(alb_get_without_mvh_event);
    expect(result).toBe("multi%C2%A5Value=red%2C+green&test%C2%A5Param=Hello+World%3A+%C2%A5");
  });
  test("from an ELB event with multi value headers enabled", () => {
    const result = awsAlbEventSource.private.constructRawQueryString(alb_get_with_mvh_event);
    expect(result).toBe("multi%C2%A5Value=red+%C2%A5+apple&multi%C2%A5Value=red%2C+green&test%C2%A5Param=Hello+World%3A+%C2%A5");
  });
  test("from an ELB event with multi value headers enabled and no querystring parameters", () => {
    const event = {
      ...alb_get_with_mvh_event,
      ...{
        multiValueQueryStringParameters: {}
      }
    };
    const result = awsAlbEventSource.private.constructRawQueryString(event);
    expect(result).toBe("");
  });
});

module.exports = {
  alb_get_without_mvh_event,
  alb_post_without_mvh_event,
  alb_get_with_mvh_event,
  alb_post_with_mvh_event,
};
