// netlify/functions/shipping-config.js
const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const p = path.join(__dirname, 'config', 'shipping.json');
    const raw = fs.readFileSync(p, 'utf8'); // will throw if path wrong
    const data = JSON.parse(raw);           // will throw if invalid JSON

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('shipping-config error:', err);
    return { statusCode: 500, body: 'shipping-config failed' };
  }
};
