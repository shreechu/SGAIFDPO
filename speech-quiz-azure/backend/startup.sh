#!/bin/sh
cd /home/site/wwwroot
npm install --production
node dist/index.js
