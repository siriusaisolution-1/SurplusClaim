const fs = require('fs');
const path = require('path');

function fileContains(relativePath, marker) {
  const content = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
  if (!content.includes(marker)) {
    throw new Error(`Expected ${relativePath} to contain marker: ${marker}`);
  }
}

fileContains('src/components/ComplianceNotice.tsx', 'Compliance guardrails');
fileContains('src/pages/_app.tsx', '<ComplianceNotice />');
fileContains('src/pages/triage.tsx', 'guardSuggestionResponse');

console.log('Web legal safety checks passed');
