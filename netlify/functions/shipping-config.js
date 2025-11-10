// netlify/functions/shipping-config.js
const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const cfg = require('./config/shipping.json');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(cfg)
    };
  } catch (err) {
    console.error('shipping-config failed:', err);
    return { statusCode: 500, body: 'shipping-config error' };
  }
};
