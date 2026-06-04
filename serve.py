#!/usr/bin/env python3
"""Tiny static dev server that disables caching, so code edits always load on reload."""
import http.server
import socketserver

PORT = 8753


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('', PORT), NoCacheHandler) as httpd:
        print(f'Serving on http://localhost:{PORT} (no-cache)')
        httpd.serve_forever()
