server {
    listen 80;

    # K8s CoreDNS internal IP
    resolver 10.96.0.10 valid=10s;

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        # Using a variable forces Nginx to resolve DNS dynamically at request time
        set $backend_upstream http://backend-service:5000;
        proxy_pass $backend_upstream/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
