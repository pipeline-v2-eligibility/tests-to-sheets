const axios = require('axios');
const fs = require('fs').promises;
const core = require('@actions/core');
const { context } = require('@actions/github');
const fileExists = require('fs.promises.exists');

let props;
let countAllTests = 0;
let skippedSome = false;

const getStatsFor = async (track) => {
  const filePath = `${process.cwd()}/audits/${track}/stats.json`;
  const reportExists = await fileExists(filePath);

  if (reportExists === true) {
    let stats = {};

    const rawData = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(rawData);

    if (track === 'backend' || track === 'cloud') {      // Jest/Vitest tests
      const { numTotalTests, numPassedTests, numPendingTests} = payload;

      stats.passed = numPassedTests;
      stats.tests = numTotalTests - numPendingTests;
      skippedSome = numPendingTests >= 1 ? true : false;
    }
    
    if (track === 'frontend') {                         // Playwright tests
      stats.tests = 0;
      stats.passed = 0;

      let skipped = 0;
      payload.suites.forEach(({specs}) => {
        stats.tests += specs.length;

        let passed = 0;
        specs.forEach(s => {
          passed += s.tests[0].results.filter(r => r.status === "passed").length;
          skipped += s.tests[0].results.filter(r => r.status === "skipped").length;
        });
        stats.passed += passed;
      });

      if (skipped >= 1) {
        skippedSome = true;
        stats.tests -= skipped;
      }
    }

    return stats;
  }

  return {
    tests: 0,
    passed: 0
  };
  
};

const reportAttempt = async (track, opts) => {
    const { token, server, sheetid } = opts;
    const stats = await getStatsFor(track);

    const { repo, owner } = context.repo;
    const { repository, pusher } = context.payload;
    const sheet = 'entries';

    // dont send data for skipped tests
    countAllTests += stats.tests;
    if (stats.tests <= 0) return;

    const data = {
        repo,
        name: props.name || owner,
        owner: props.githubUsername || owner,
        ...stats,
        track,
        url: repository.url,
        source: 'pipeline-v2-eligibility',
        since: (new Date()).toUTCString(),
        email: props.email || repository.owner.email || pusher.email
    };

    const apiHeaders = {
        "X-Spreadsheet-Id": `${sheetid}`,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    };

    const { data: existing } = await axios.get(`${server}/${sheet}?where={'repo':'${repo}'}`, {
        headers: apiHeaders
    });

    const found = existing.results.find((e) => e.repo === repo && e.track === track);
    if (found) {
        // update the record and exit this function
        data.attempts = parseInt(found.attempts, 10) + 1;
        await axios.put(`${server}/${sheet}/${found.rowIndex}`, data, {
            headers: apiHeaders
        });
        return;
    }
    
    data.attempts = 1;
    await axios.post(`${server}/${sheet}`, data, {
        headers: apiHeaders
    });
};

const run = async () => {
  try {
    const about = core.getInput('about');
    const aboutFileExists = await fileExists(about);
    if (aboutFileExists === false) {
      core.setFailed('Please create an about.json file at the root of your code repository');
    }
    
    const data = await fs.readFile(about, 'utf8');
    props = JSON.parse(data);
    console.warn('Props', props);

    if (!props.email || props.email === '' || !props.githubUsername || props.githubUsername === '' || !props.deployedAppURL || props.deployedAppURL === '' ) {
      core.setFailed('Please fill in the needed details into the about.json file at the root your code repository');
    }

    const track = core.getInput('track');
    const token = core.getInput('token');
    const server = core.getInput('server');
    const sheetid = core.getInput('sheetid');

    await reportAttempt(track, { token, server, sheetid });

    // Flag it if no tests ran at all
    if (countAllTests === 0) {
      core.setFailed('This should not be happening! All tests were skipped!! Please review the instructions carefully!!!');
    }

    if (skippedSome === true) {
      console.warn('It appears a number of tests were skipped. Pls carefully review the instructions to ensure all required tests for are app gets executed');
    }

  } catch (error) {
    core.setFailed(error.message);
  }
};

run();