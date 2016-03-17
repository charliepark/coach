'use strict';

const fs = require('fs'),
  snufkin = require('snufkin'),
  browsertime = require('browsertime'),
  path = require('path'),
  Promise = require('bluebird'),
  merger = require('./merge').merge,
  split = require('./har/harCutter').split,
  harRunner = require('./har');

Promise.promisifyAll(fs);

function getPagesFromHar(harJson) {
  return Promise.resolve(harJson)
    .then((harJson) => snufkin.convert(harJson, {
      includeAssets: true
    }));
}

function getDefaultDomOptions(url, skipHar) {
  const options = {
    url,
    browser: 'firefox',
    iterations: 1
  };
  if (skipHar) {
    return options;
  } else {
    options.experimental = {
      nativeHar: true
    }
  }
}

function browsertimeify(script) {
  return Promise.resolve(script)
    .then((script) => {
      return {
        coachAdvice: script
      };
    })
    .then((scriptObject) => {
      return {
        "coach": scriptObject
      }
    })
}


module.exports = {
  getDomAdvice() {
    return fs.readFileAsync(path.resolve(__dirname, '..', 'dist', 'coach.min.js'), 'utf8');
  },
  runDomAdvice(url, script, options) {
    let coachScript = script ? browsertimeify(script) : browsertimeify(this.getDomAdvice());
    options = options || getDefaultDomOptions(url, true);
    browsertime.logging.configure(options);
    let runner = new browsertime.Engine(options);

    return runner.start()
      .then(() => runner.run(url, coachScript))
      .finally(() => runner.stop());
  },
  getHarAdvice() {
    let rootPath = path.resolve(__dirname, 'har', 'performance');

    return fs.readdirAsync(rootPath)
      .map((fileName) => path.resolve(rootPath, fileName))
      .filter((file) => fs.statAsync(file).then((stats) => stats.isFile()))
      .map((file) => require(file));
  },
  runHarAdvice(har, script, options) {
    let harScript = script ? script : this.getHarAdvice();
    return harRunner.runAdvice(getPagesFromHar(har), harScript, options);
  },
  merge(domAdvice, harAdvice) {
    return merger(domAdvice, harAdvice);
  },
  splitHar(har, pageIndex) {
    return split(har, pageIndex);
  },
  run(url, domScript, harScript, domOptions, harOptions) {
    let coachScript = domScript ? domScript : this.getDomAdvice();
    let coachHarScript = harScript ? harScript : this.getHarAdvice();

    domOptions = domOptions || getDefaultDomOptions(url, false);

    let browsertime = this.runDomAdvice(url, coachScript, domOptions);

    let har = browsertime.then((result) => this.runHarAdvice(result.har, coachHarScript, harOptions));
    let self = this;
    return Promise.join(browsertime, har, function(browsertimeResult, harResult) {
      return self.merge(browsertimeResult.browsertimeData[0].coach, harResult);
    }).catch((error) => {
      return {
        error: 'We got an error: ' + error
      };
    });
  }
};