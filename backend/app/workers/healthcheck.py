import os
import sys
import time

p = "/tmp/worker_heartbeat"
sys.exit(0 if os.path.exists(p) and time.time() - os.path.getmtime(p) < 90 else 1)
