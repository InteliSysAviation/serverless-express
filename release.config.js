module.exports = {
  ci: false, // only run the builds locally
  debug: true, // output debugging information
  repositoryUrl: 'git@github.com:InteliSysAviation/serverless-express.git',
  branches: [
    'mainline'
  ],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'angular'
      }
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'angular'
      }
    ],
    '@semantic-release/changelog',
    [
      '@semantic-release/npm',
      {
        // Do not publish the npm package to the registry.
        // Setting npmPublish to false is not necessary since the package.json 'private' property is true,
        // it's nice to be explicit about it.
        npmPublish: false,
        tarballDir: 'dist'
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            path: 'dist/*.tgz'
          }
        ]
      }
    ],
    [
      '@semantic-release/git',
      {
        assets: [
          'package.json',
          'package-lock.json',
          'CHANGELOG.md',
          'dist/**/*.{js|css}'
        ]
      }
    ]
  ]
}
