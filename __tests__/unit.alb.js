const eventSources = require('../src/event-sources')
const testUtils = require('./utils')

const apiGatewayEventSource = eventSources.getEventSource({
  eventSourceName: 'AWS_ALB'
})

test('GET request has correct headers when multi-valued headers are not enabled', () => {
  const request = apiGatewayEventSource.getRequest({ event: testUtils.albGetWithoutMvhEvent })
  // see https://github.com/vendia/serverless-express/issues/387
  expect(typeof request).toEqual('object')
  expect(JSON.stringify(request.headers)).toEqual(
    '{"accept":"*/*","accept-encoding":"gzip, deflate, br","connection":"keep-alive","host":"echoevent.intelisysqa.ca",' +
'"postman-token":"0ca3fb83-0b91-4e47-bb03-359746d144b4","user-agent":"PostmanRuntime/7.28.0",' +
'"x-amzn-trace-id":"Root=1-60c06484-136f10932a9d72ea34407239","x-forwarded-for":"14.169.54.234",' +
'"x-forwarded-port":"443","x-forwarded-proto":"https","x-multivalue-header":"veg,celery","content-length":0}'
  )
})

test('GET request has correct headers when multi-valued headers are enabled', () => {
  const request = apiGatewayEventSource.getRequest({ event: testUtils.albGetWithMvhEvent })
  // see https://github.com/vendia/serverless-express/issues/387
  expect(typeof request).toEqual('object')
  expect(JSON.stringify(request.headers)).toEqual(
    '{"accept":"*/*","accept-encoding":"gzip, deflate, br","connection":"keep-alive","host":"echoevent.intelisysqa.ca",' +
'"postman-token":"f1231e8c-4929-4b91-b8b7-a818a4b1a98a","user-agent":"PostmanRuntime/7.28.0",' +
'"x-amzn-trace-id":"Root=1-60c0630d-67397f4609b8e19d5ca10427","x-forwarded-for":"14.169.54.234",' +
'"x-forwarded-port":"443","x-forwarded-proto":"https","x-multivalue-header":"veg,pea,veg,celery","content-length":0}'
  )
})

test('POST request has correct headers when multi-valued headers are not enabled', () => {
  const request = apiGatewayEventSource.getRequest({ event: testUtils.albPostWithoutMvhEvent })
  // see https://github.com/vendia/serverless-express/issues/387
  expect(typeof request).toEqual('object')
  expect(JSON.stringify(request.headers)).toEqual(
    '{"accept":"*/*","accept-encoding":"gzip, deflate, br","connection":"keep-alive","content-length":425,' +
    '"content-type":"multipart/form-data; boundary=--------------------------053813846626992301385195",' +
    '"host":"echoevent.intelisysqa.ca","postman-token":"49429809-039d-4171-a920-db2f04feb390",' +
    '"user-agent":"PostmanRuntime/7.28.0","x-amzn-trace-id":"Root=1-60c06465-2549927316296af552839b7d",' +
    '"x-forwarded-for":"14.169.54.234","x-forwarded-port":"443","x-forwarded-proto":"https",' +
    '"x-multivalue-header":"veg,celery"}'
  )
})

test('POST request has correct headers when multi-valued headers are enabled', () => {
  const request = apiGatewayEventSource.getRequest({ event: testUtils.albPostWithMvhEvent })
  // see https://github.com/vendia/serverless-express/issues/387
  expect(typeof request).toEqual('object')
  expect(JSON.stringify(request.headers)).toEqual(
    '{"accept":"*/*","accept-encoding":"gzip, deflate, br","connection":"keep-alive","content-length":425,' +
    '"content-type":"multipart/form-data; boundary=--------------------------790755205523996327761243",' +
    '"host":"echoevent.intelisysqa.ca","postman-token":"da3ce04c-d67c-44a6-b707-c83755334b1d",' +
    '"user-agent":"PostmanRuntime/7.28.0","x-amzn-trace-id":"Root=1-60c063d6-338c9f07762d7142793c4ae5",' +
    '"x-forwarded-for":"14.169.54.234","x-forwarded-port":"443","x-forwarded-proto":"https",' +
    '"x-multivalue-header":"veg,pea,veg,celery"}'
  )
})

describe('get remote IP address', () => {
  test('from an ELB event with multi value headers disabled', () => {
    const request = apiGatewayEventSource.getRequest({ event: testUtils.albGetWithoutMvhEvent })
    expect(request.remoteAddress).toBe('14.169.54.234')
  })
  test('from an ELB event with multi value headers enabled', () => {
    const request = apiGatewayEventSource.getRequest({ event: testUtils.albGetWithMvhEvent })
    expect(request.remoteAddress).toBe('14.169.54.234')
  })
})

describe('get raw querystring', () => {
  test('from an ELB event with multi value headers disabled and no querystring parameters', () => {
    const event = {
      ...testUtils.albGetWithoutMvhEvent,
      ...{
        queryStringParameters: {}
      }
    }
    const request = apiGatewayEventSource.getRequest({ event })
    const expectedPath = '/pp%C2%A5pp'
    expect(request.path).toBe(expectedPath)
  })
  test('from an ELB event with multi value headers disabled', () => {
    const event = testUtils.albGetWithoutMvhEvent
    const request = apiGatewayEventSource.getRequest({ event })
    const expectedPath = '/pp%C2%A5pp?multi%C2%A5Value=red%2C+green&test%C2%A5Param=Hello+World%3A+%C2%A5'
    expect(request.path).toBe(expectedPath)
  })
  test('from an ELB event with multi value headers enabled', () => {
    const event = testUtils.albGetWithMvhEvent
    const request = apiGatewayEventSource.getRequest({ event })
    const expectedPath = '/pp%C2%A5pp?multi%C2%A5Value=red+%C2%A5+apple&multi%C2%A5Value=red%2C+green&test%C2%A5Param=Hello+World%3A+%C2%A5'
    expect(request.path).toBe(expectedPath)
  })
  test('from an ELB event with multi value headers enabled and no querystring parameters', () => {
    const event = {
      ...testUtils.albGetWithMvhEvent,
      ...{
        multiValueQueryStringParameters: {}
      }
    }
    const request = apiGatewayEventSource.getRequest({ event })
    const expectedPath = '/pp%C2%A5pp' // /pp¥pp
    expect(request.path).toBe(expectedPath)
  })
})
