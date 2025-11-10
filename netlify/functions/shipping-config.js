// netlify/functions/shipping-config.js
const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const p = path.join(__dirname, 'config', 'shipping.json');
    const json = fs.readFileSync(p, 'utf8');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: json
    };
  } catch (err) {
    console.error('shipping-config failed:', err);
    return { statusCode: 500, body: 'shipping-config error' };
  }
};