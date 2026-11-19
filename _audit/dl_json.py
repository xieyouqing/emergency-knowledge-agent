import sys, urllib.request, json, os

url = sys.argv[1]
out = sys.argv[2]
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=120) as r:
    data = r.read()
with open(out, "wb") as f:
    f.write(data)
head = data[:60]
print("bytes:", len(data))
print("head:", head[:60])
try:
    json.loads(data.decode("utf-8"))
    print("json: OK")
except Exception as e:
    print("json: FAIL", e)
