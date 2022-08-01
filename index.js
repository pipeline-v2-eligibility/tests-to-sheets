const fs = require('fs').promises;
const fileExists = require('fs.promises.exists');
const core = require('@actions/core');
const { context } = require('@actions/github');
const axios = require('axios');

let props;
let countAllTests = 0;

const getStatsFor = async (track) => {
  const filePath = `${process.cwd()}/audits/${track}/stats.json`;
  const reportExists = await fileExists(filePath);

  if (reportExists === true) {
    let stats = {};

    const rawData = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(rawData);
    const { numTotalTests, numPassedTests, numPendingTests} = payload;

    stats.passed = numPassedTests;
    stats.tests = numTotalTests - numPendingTests;

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
    const properties = core.getInput('properties');
    const data = await fs.readFile(properties, 'utf8');
    props = JSON.parse(data);

    if (!props.email || props.email === '' || !props.githubUsername || props.githubUsername === '' || !props.apiBaseURL || props.apiBaseURL === '' ) {
      core.setFailed('Please fill in the needed details into the properties.json file within your code repository');
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

  } catch (error) {
    core.setFailed(error.message);
  }
};

run();