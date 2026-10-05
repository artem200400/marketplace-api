module.exports = {
    preset: 'ts-jest/presets/default-esm',

    testEnvironment: 'node',

    extensionsToTreatAsEsm: [
        '.ts'
    ],

    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: 'tsconfig.jest.json'
            }
        ]
    },

    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
    },

    reporters: [
        'default'
    ],

    maxWorkers: 1,

    testTimeout: 60000,

    testMatch: [
        '<rootDir>/test/**/*.spec.ts'
    ]
}