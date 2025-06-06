const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { randomUUID } = require('crypto')
const { debug: createDebug } = require('debug')

let s3Client // Initialized by getLargeResponseHandlingConfiguration

function getNumericEnvVar (varName, minValue, defaultValue) {
  let result = defaultValue
  const parsedValue = parseInt(process.env[varName])
  if (!isNaN(parsedValue)) {
    if (parsedValue >= minValue) {
      result = parsedValue
    } else {
      result = minValue
      console.error(`Environment variable "${varName}" is set to ${parsedValue}, but that value is less than the minimum ` +
        `allowable value of ${minValue}. Therefore, the minimum value of ${minValue} will be used.`)
    }
  }
  return result
}

const thirtyKiB = 30 * 1024
const tenMiB = 10 * 1024 * 1024
const oneMiB = 1024 * 1024

// REST and HTTP API response size is limited to 10 MiB, so we set the default threshold to 10 MiB, less a bit
const DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API = tenMiB - 50000
const DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API = DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API

// ALB response size is limited to 11 MiB, so we set the default threshold to 10 MiB, less a bit
const DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API = oneMiB - 50000

// Default signed URL lifetime
const DEFAULT_PRESIGNED_URL_LIFETIME_IN_SECONDS = 600

/**
 * REST (v1) APIs, HTTP (v2) APIs and ALB event sources can all handle "large" responses via configuration. The
 * configuration of that is done via environment variables, as follows:
 *
 *   REQUIRED
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_S3_BUCKET_REGION: The region of the S3 bucket.
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_S3_BUCKET_NAME: The name of the S3 bucket where the large response
 *         data is held pending subsequent retrieval. E.g. "acmeair-soar-app-qa-prod"
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_S3_OBJECT_KEY_PREFIX: The prefix of large response data objects
 *         within the S3 bucket. This can be thought of as a directory within the bucket where the repsonse objects are
 *         stored. E.g. "assets/ephemeral/"
 *
 *   OPTIONAL
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_SIZE_THRESHOLD_REST_API: The number of bytes in a REST API
 *         response that qualifies the response size as "large". If not specified, this will default to 9.9 MiB.
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_SIZE_THRESHOLD_HTTP_API: The number of bytes in a HTTP API
 *         response that qualifies the response size as "large". If not specified, this will default to 9.9 MiB.
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_SIZE_THRESHOLD_ALB_API: The number of bytes in an ALB API
 *         response that qualifies the response size as "large". If not specified, this will default to 0.9 MiB.
 *     - SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_PRESIGNED_URL_LIFETIME_IN_SECONDS: The lifetime of the signed URL
 *         providing access to the S3 object that stores the large response data.
 *
 * This method returns a well-shaped object of the corresponding configuration data, or undefined if any of the
 * require configuration is bad.
 */
let largeResponseHandlingConfigurationInitialized = false
let largeResponseHandlingConfiguration
function getLargeResponseHandlingConfiguration () {
  if (largeResponseHandlingConfigurationInitialized) {
    return largeResponseHandlingConfiguration
  }

  const debug = createDebug('serverless-express::large-response-utils:getLargeResponseHandlingConfiguration')
  const result = {
    s3BucketDetails: {
      region: (process.env.SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_S3_BUCKET_REGION ?? '').trim(),
      bucketName: (process.env.SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_S3_BUCKET_NAME ?? '').trim(),
      objectKeyPrefix: (process.env.SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_S3_OBJECT_KEY_PREFIX ?? '').trim()
    }
  }
  if (result.s3BucketDetails.region.length === 0 ||
    result.s3BucketDetails.bucketName.length === 0 ||
    result.s3BucketDetails.objectKeyPrefix.length === 0) {
    debug('A required configuration is missing. If you want large response handling enabled, you must configure it properly.')
    return largeResponseHandlingConfiguration
  }

  result.restApiLargeResponseThreshold = getNumericEnvVar('SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_SIZE_THRESHOLD_REST_API', thirtyKiB, DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API)
  result.httpApiLargeResponseThreshold = getNumericEnvVar('SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_SIZE_THRESHOLD_HTTP_API', thirtyKiB, DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API)
  result.albApiLargeResponseThreshold = getNumericEnvVar('SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_SIZE_THRESHOLD_ALB_API', thirtyKiB, DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API)
  result.signedUrlLifetime = getNumericEnvVar('SERVERLESS_EXPRESS_LARGE_RESPONSE_HANDLING_PRESIGNED_URL_LIFETIME_IN_SECONDS', 30, DEFAULT_PRESIGNED_URL_LIFETIME_IN_SECONDS)

  largeResponseHandlingConfiguration = result
  largeResponseHandlingConfigurationInitialized = true

  debug('Configuration initialized: %o', largeResponseHandlingConfiguration)

  debug('Initializing S3Client with region %s.', largeResponseHandlingConfiguration.s3BucketDetails.region)
  s3Client = new S3Client({ region: largeResponseHandlingConfiguration.s3BucketDetails.region })

  return largeResponseHandlingConfiguration
}

function createS3ObjectKey () {
  const lrhConfiguration = getLargeResponseHandlingConfiguration()
  return `${lrhConfiguration.s3BucketDetails.objectKeyPrefix}${randomUUID()}`
}

async function putBodyBufferInS3Object (bodyBuffer, responseHeaders, objectKey) {
  const debug = createDebug('serverless-express::large-response-utils:putBodyBufferInS3Object')
  const lrhConfiguration = getLargeResponseHandlingConfiguration()
  const bucketName = lrhConfiguration.s3BucketDetails.bucketName
  const lowercasedHeaders = {}
  for (const [name, value] of Object.entries(responseHeaders)) {
    lowercasedHeaders[name.toLowerCase()] = value
  }

  const putObjectCommandInput = {
    Bucket: bucketName,
    Key: objectKey,
    Body: bodyBuffer
  }
  debug('lowercasedHeaders: %o', lowercasedHeaders)
  if (lowercasedHeaders['content-type']) {
    putObjectCommandInput.ContentType = lowercasedHeaders['content-type']
    debug('set object ContentType to "%s"', putObjectCommandInput.ContentType)
  }
  if (lowercasedHeaders['content-encoding']) {
    putObjectCommandInput.ContentEncoding = lowercasedHeaders['content-encoding']
    debug('set object ContentEncoding to "%s"', putObjectCommandInput.ContentEncoding)
  }
  if (lowercasedHeaders['content-language']) {
    putObjectCommandInput.ContentLanguage = lowercasedHeaders['content-language']
    debug('set object ContentLanguage to "%s"', putObjectCommandInput.ContentLanguage)
  }
  if (lowercasedHeaders['content-disposition']) {
    putObjectCommandInput.ContentDisposition = lowercasedHeaders['content-disposition']
    debug('set object ContentDisposition to "%s"', putObjectCommandInput.ContentDisposition)
  }

  const startUploadAt = performance.now()
  await s3Client.send(new PutObjectCommand(putObjectCommandInput))
  debug('S3 Upload Time: %d ms', Math.ceil(performance.now() - startUploadAt))
  debug('Object "%s" uploaded successfully to bucket "%s"', objectKey, bucketName)
}

async function getSignedUrlForS3Object (objectKey) {
  const debug = createDebug('serverless-express::large-response-utils:putBodyBufferInS3Object')
  const lrhConfiguration = getLargeResponseHandlingConfiguration()
  const { bucketName, signedUrlLifetime } = lrhConfiguration.s3BucketDetails

  const getObjectCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey
  })
  const startGetAndSignAt = performance.now()
  const signedUrl = await getSignedUrl(s3Client, getObjectCommand, { expiresIn: signedUrlLifetime })
  debug('Presigned URL generation time: %d ms', Math.ceil(performance.now() - startGetAndSignAt))
  debug('Signed URL for retrieving object "%s" from bucket "%s": %s', objectKey, bucketName, signedUrl)
  return signedUrl
}

module.exports = {
  createS3ObjectKey,
  DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_REST_API,
  DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_HTTP_API,
  DEFAULT_LARGE_RESPONSE_SIZE_THRESHOLD_ALB_API,
  getLargeResponseHandlingConfiguration,
  getSignedUrlForS3Object,
  putBodyBufferInS3Object
}
