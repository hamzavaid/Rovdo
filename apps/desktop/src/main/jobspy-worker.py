"""Optional JobSpy adapter. No direct sockets, browser impersonation, cookies or proxy transport.

The parent owns HTTPS, public-address checks, robots rules and throttling. Unsupported
POST/auth/challenge flows fail closed. This is process isolation, not an OS sandbox.
"""
import base64
import contextlib
import io
import json
import socket
import sys
import threading

wire_in, wire_out = sys.stdin, sys.stdout


class Discard(io.TextIOBase):
    # Third-party diagnostics are discarded rather than buffered in worker memory.
    def write(self, text):
        return len(text)



def emit(value):
    wire_out.write(json.dumps(value, allow_nan=False) + "\n")
    wire_out.flush()


def blocked(*args, **kwargs):
    raise RuntimeError("DIRECT_NETWORK_DISABLED")


def main():
    options = json.loads(wire_in.readline())
    try:
        import requests
        import curl_cffi.requests
    except ImportError:
        emit({"type": "error", "code": "JOBSPY_UNAVAILABLE"})
        return

    lock = threading.Lock()

    def request_unlocked(self, method, url, **kwargs):
        # Authentication and proxies are never forwarded; even GET cookies are omitted.
        if kwargs.get("auth") or kwargs.get("proxies") or kwargs.get("data") or kwargs.get("json"):
            emit({"type": "error", "code": "JOBSPY_POLICY_BLOCKED"})
            raise RuntimeError("UNSUPPORTED_REQUEST")
        prepared = requests.Request(method, url, params=kwargs.get("params")).prepare()
        emit({"type": "request", "method": str(method).upper(), "url": prepared.url})
        value = json.loads(wire_in.readline())
        response = requests.Response()
        response.status_code = value["status"]
        response.headers.update(value["headers"])
        response._content = base64.b64decode(value["body"])
        response.url = prepared.url
        response.encoding = "utf-8"
        return response

    def request(self, method, url, **kwargs):
        with lock:
            return request_unlocked(self, method, url, **kwargs)

    requests.Session.request = request
    curl_cffi.requests.Session.request = request
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked
    try:
        # Third-party logging/printing is never part of the JSON-line protocol.
        with contextlib.redirect_stdout(Discard()), contextlib.redirect_stderr(Discard()):
            from jobspy import scrape_jobs
            filters = {}
            if options.get("workMode") == "remote":
                filters["is_remote"] = True
            types = {"full-time": "fulltime", "part-time": "parttime", "internship": "internship", "contract": "contract", "temporary": "temporary"}
            if options.get("employmentType") in types:
                filters["job_type"] = types[options["employmentType"]]
            if options.get("freshnessDays"):
                filters["hours_old"] = options["freshnessDays"] * 24
            jobs = scrape_jobs(site_name=[options["site"]], search_term=options["query"],
                               location=options["location"] or None, offset=options["offset"],
                               results_wanted=50, verbose=0, fetch_description=True,
                               user_agent="Rovdo/0.3.8 public-source reader", **filters)
            rows = json.loads(jobs.to_json(orient="records", date_format="iso"))
        emit({"type": "result", "rows": rows})
    except ImportError:
        emit({"type": "error", "code": "JOBSPY_UNAVAILABLE"})
    except Exception:
        emit({"type": "error", "code": "JOBSPY_WORKER_FAILED"})


if __name__ == "__main__":
    main()
