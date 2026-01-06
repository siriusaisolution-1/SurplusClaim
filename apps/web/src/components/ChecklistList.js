/* eslint-disable import/order, @typescript-eslint/no-var-requires */
const React = require('react');

function ChecklistList({ items }) {
  if (!items || items.length === 0) {
    return React.createElement('p', { style: { color: '#9ca3af' } }, 'No checklist items');
  }

  return React.createElement(
    React.Fragment,
    null,
    items.map((item) =>
      React.createElement(
        'div',
        { key: item.id, style: { borderBottom: '1px solid #1f2937', padding: '0.5rem 0' } },
        React.createElement(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement(
            'div',
            null,
            React.createElement('strong', null, item.title),
            item.description
              ? React.createElement(
                  'div',
                  { style: { color: '#9ca3af', fontSize: '0.9rem' } },
                  item.description
                )
              : null,
            item.conditions
              ? React.createElement(
                  'div',
                  { style: { color: '#c084fc', fontSize: '0.85rem' } },
                  item.conditions
                )
              : null
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
            React.createElement('span', { className: 'tag' }, item.type === 'form' ? 'Form' : 'Document'),
            React.createElement(
              'span',
              {
                className: 'tag',
                style: { background: item.completed ? '#10b981' : '#6b7280' }
              },
              item.completed ? 'Complete' : 'Pending'
            )
          )
        )
      )
    )
  );
}

module.exports = { ChecklistList };
