// netlify/functions/shipping-config.js
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const p = path.join(__dirname, 'config', 'shipping.json'); // same file your checkout uses
    const json = fs.readFileSync(p, 'utf8');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300' // 5 min client cache (tweak if you want)
      },
      body: json
    };
  } catch (err) {
    console.error('shipping-config error:', err);
    return { statusCode: 500, body: 'Failed to load shipping config' };
  }
};
