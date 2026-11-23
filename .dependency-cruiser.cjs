module.exports = {
  forbidden: [
    {
      name: 'no-cross-feature-private-imports',
      severity: 'error',
      from: {
        path: '^src/(?:modules|features)/([^/]+)/'
      },
      to: {
        path: '^src/(?:modules|features)/(?!$1/)'
      }
    },
    {
      name: 'hw32-demo-forbidden-import',
      severity: 'error',
      from: {
        path: '^hw32-fixtures/architecture/broken/'
      },
      to: {
        path: '^hw32-fixtures/architecture/forbidden/'
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    }
  }
}
