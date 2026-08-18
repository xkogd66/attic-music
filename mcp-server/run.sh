#!/bin/bash
set -a
source "$(dirname "$0")/gonic.env"
set +a
exec node "$(dirname "$0")/index.js"
