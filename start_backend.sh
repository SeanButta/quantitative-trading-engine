#!/bin/bash
cd "/Users/sean_dlresearch/Desktop/Quantative Trading Engine"
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --reload
