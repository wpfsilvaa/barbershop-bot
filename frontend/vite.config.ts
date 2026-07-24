import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'wpfsilva.tplinkdns.com',
      'localhost',
      '127.0.0.1'
    ],
    proxy: {
      // Dentro do container do frontend, `127.0.0.1` é o próprio container — o
      // backend só é alcançável pelo nome do serviço na rede do compose. Fora do
      // Docker, o padrão continua sendo o backend publicado no host.
      '/api': {
        // Sem o prefixo `VITE_`, que é o namespace exposto ao bundle do cliente:
        // isto é config de servidor e não deve vazar para o navegador.
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
