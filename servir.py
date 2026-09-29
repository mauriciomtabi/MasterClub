# Servidor local da palestra: igual ao http.server, mas proíbe cache.
# Sem isso o Chrome guarda o CSS antigo e mostra HTML novo com estilo velho.
import http.server, sys, os
class SemCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8790), SemCache).serve_forever()
