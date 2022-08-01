const fs = require('fs').promises;
const fileExists = require('fs.promises.exists');
const core = require('@actions/core');
const { context } = require('@actions/github');
const axios = require('axios');
const properties = require(`${process.cwd()}/properties.json`);

let countAllTests = 0;

const getStatsFor = async (challenge) => {
  const file = `${process.cwd()}/audits/${challenge}/${stats}.json`;
  const reportExists = await fileExists(file);

  if (reportExists === true) {
    let stats = {};

    const rawData = await fs.readFile(`${process.cwd()}/audits/${task}/${task}.json`, 'utf8');
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

const alphabets = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
const shards = {
    '0-4': 'A-E',
    '5-9': 'F-J',
    '10-14': 'K-O',
    '15-19': 'P-T',
    '20-25': 'U-Z'
};

const ownerToSheetPartition = (owner) => {
    const initial = owner.charAt(0).toLowerCase();

    let index = alphabets.indexOf(initial);
    if (index === -1) index = 25;

    const key = Object.keys(shards).find(k => {
        const [start, end] = k.split('-');
        return index >= parseInt(start, 10) && index <= parseInt(end, 10);
    });

    return shards[key];
};

const reportAChallenge = async (challenge, opts) => {
    const { token, server, sheetid } = opts;
    const stats = await getStatsFor(challenge);

    const { repo, owner } = context.repo;
    const { repository, pusher } = context.payload;
    const sheet = ownerToSheetPartition(owner);

    // dont send data for skipped tests
    countAllTests += stats.tests;
    if (stats.tests <= 0) return;

    const data = {
        repo,
        owner,
        ...stats,
        challenge,
        url: repository.url,
        source: 'pipeline-v2-eligibility',
        since: (new Date()).toUTCString(),
        email: repository.owner.email || pusher.email
    };

    const apiHeaders = {
        "X-Spreadsheet-Id": `${sheetid}`,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    };

    const { data: existing } = await axios.get(`${server}/${sheet}?where={'repo':'${repo}'}`, {
        headers: apiHeaders
    });

    const found = existing.results.find((e) => e.repo === repo && e.task === challenge);
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
    const token = core.getInput('token');
    const server = core.getInput('server');
    const sheetid = core.getInput('sheetid');
    const challenge = core.getInput('challenge');

    // await reportAChallenge(challenge, { token, server, sheetid });

    console.log('Props', properties);

    // Flag it if no tests ran at all
    if (countAllTests === 0) {
      core.setFailed('This should not be happening! All tests were skipped!! Please review the instructions carefully!!!');
    }

  } catch (error) {
    core.setFailed(error.message);
  }
};

run();