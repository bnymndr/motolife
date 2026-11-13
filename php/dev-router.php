<?php
// Yerel geliştirme/test: php -S 127.0.0.1:8080 -t <dist-php> dev-router.php   (üretimde .htaccess bu işi yapar)
$uri = (string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = $_SERVER['DOCUMENT_ROOT'];
if (str_starts_with($uri, '/api/')) { require $root . '/api/index.php'; return true; }
if (preg_match('#^/icons/(.+)$#', $uri, $m) && is_file($root . '/' . $m[1])) { $f = $root . '/' . $m[1]; header('Content-Type: ' . (mime_content_type($f) ?: 'application/octet-stream')); readfile($f); return true; }
return false;
