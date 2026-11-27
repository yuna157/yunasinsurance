"""Run the app on this computer without exposing it to the local network."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
import webbrowser

directory = Path(__file__).resolve().parent
handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
with ThreadingHTTPServer(("127.0.0.1", 8765), handler) as server:
    url = "http://localhost:8765/"
    print(f"YUNA'S INSURANCE: {url}")
    print("Keep this window open while you use the app.")
    Timer(0.25, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
