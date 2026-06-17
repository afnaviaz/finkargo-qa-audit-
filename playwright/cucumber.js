module.exports = {
  default: {
    paths: ['src/tests/features/**/*.feature'],
    require: [
      'src/tests/steps/**/*.ts',
      'src/tests/hooks.ts',
      'src/tests/world.ts'
    ],
    requireModule: ['ts-node/register'],
    format: ['progress', 'allure-cucumberjs/reporter'],
    formatOptions: { resultsDir: 'allure-results' },
    dryRun: false
  }
};