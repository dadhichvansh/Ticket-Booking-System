# 09 - Benchmarks

## Test machine (A-6)

- CPU: Intel Core i5-12450HX (12th Gen)
- CPU cores/threads: 8 cores / 12 logical processors, 2.40 GHz base speed
- RAM: 12 GB
- Disk: NVMe SSD
- OS: Windows 11
- Docker version: 29.9.2 (from `docker --version`)
- Memory available to Docker (WSL2 limit): 5.64 GB (`docker info --format "{{.MemTotal}}"` = 6061596672 bytes; `.wslconfig` set to memory=6GB, processors=8, swap=2GB)
- Note: 503 responses during failure test F4 (Redis restart) are expected and are not NFR-10 failures (05 section 9).

No benchmarks recorded yet.
