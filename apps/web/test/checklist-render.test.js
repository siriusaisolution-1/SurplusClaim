const assert = require('node:assert');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { ChecklistList } = require('../src/components/ChecklistList');

const mockChecklist = [
  {
    id: 'claimant-id',
    title: 'Government-issued photo ID',
    description: 'ID for the claimant',
    required: true,
    type: 'document',
    jurisdiction: { state: 'GA', county_code: 'FULTON', county_name: 'Fulton County' },
    completed: true
  },
  {
    id: 'fulton-form',
    title: 'County claim form',
    required: true,
    type: 'form',
    jurisdiction: { state: 'GA', county_code: 'FULTON', county_name: 'Fulton County' },
    completed: false
  }
];

const html = renderToStaticMarkup(React.createElement(ChecklistList, { items: mockChecklist }));

assert.ok(html.includes('Government-issued photo ID'));
assert.ok(html.includes('County claim form'));
assert.ok(html.includes('Complete'));
assert.ok(html.includes('Pending'));

console.log('Checklist rendering test passed');
