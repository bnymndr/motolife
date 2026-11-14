-- Moto Life — MySQL/MariaDB şeması (phpMyAdmin › İçe Aktar ile yüklenebilir).
-- Uygulama bu tabloları ilk istekte kendisi de kurar; bu dosya yalnızca elle kurulum / kontrol içindir.
-- Önce cPanel'de veritabanını seç, sonra bu dosyayı içe aktar. Birden çok kez çalıştırılabilir.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ml_kv (k VARCHAR(190) PRIMARY KEY, v MEDIUMTEXT, exp BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_users (id CHAR(24) PRIMARY KEY, username VARCHAR(40) NOT NULL, ulc VARCHAR(190) NOT NULL UNIQUE, email VARCHAR(190) NOT NULL UNIQUE, phone VARCHAR(30) NULL UNIQUE, first_name VARCHAR(80) NOT NULL DEFAULT '', last_name VARCHAR(80) NOT NULL DEFAULT '', gender VARCHAR(30) NOT NULL DEFAULT 'belirtmek-istemiyorum', bike_brand VARCHAR(80) NOT NULL DEFAULT '', bike_model VARCHAR(80) NOT NULL DEFAULT '', bike_year INT NULL, bike_type VARCHAR(20) NOT NULL DEFAULT '', bike_cc INT NULL, emergency_name VARCHAR(80) NOT NULL DEFAULT '', emergency_phone VARCHAR(30) NOT NULL DEFAULT '', pw_hash VARCHAR(255) NULL, sv INT NOT NULL DEFAULT 0, reset_hash VARCHAR(64) NULL, reset_exp BIGINT NOT NULL DEFAULT 0, avatar MEDIUMTEXT NULL, created_at BIGINT NOT NULL DEFAULT 0, bio VARCHAR(255) NOT NULL DEFAULT '', status VARCHAR(255) NOT NULL DEFAULT '', mood VARCHAR(20) NOT NULL DEFAULT '', status_at BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_posts (id CHAR(16) PRIMARY KEY, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL, mood VARCHAR(20) NOT NULL DEFAULT '', image CHAR(16) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_likes (post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, PRIMARY KEY (post, uid)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_comments (id CHAR(16) PRIMARY KEY, post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_images (id CHAR(16) PRIMARY KEY, uid CHAR(24) NOT NULL, at BIGINT NOT NULL, post CHAR(16) NULL, data MEDIUMBLOB NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_friends (a CHAR(24) NOT NULL, b CHAR(24) NOT NULL, PRIMARY KEY (a, b)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_blocks (a CHAR(24) NOT NULL, b CHAR(24) NOT NULL, at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (a, b)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_requests (id CHAR(16) PRIMARY KEY, from_uid CHAR(24) NOT NULL, to_uid CHAR(24) NOT NULL, at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_msgs (id CHAR(16) PRIMARY KEY, pair VARCHAR(50) NOT NULL, from_uid CHAR(24) NOT NULL, to_uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL, rd TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rides (uid CHAR(24) NOT NULL, id VARCHAR(40) NOT NULL, started BIGINT NOT NULL, ended BIGINT NOT NULL, summary TEXT NOT NULL, data MEDIUMTEXT NOT NULL, tele MEDIUMTEXT NULL, telesum TEXT NULL, received BIGINT NOT NULL, PRIMARY KEY (uid, id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rg (id CHAR(16) PRIMARY KEY, name VARCHAR(80) NOT NULL, code CHAR(8) NOT NULL UNIQUE, leader CHAR(24) NOT NULL, created_at BIGINT NOT NULL, gap INT NOT NULL DEFAULT 1000, route_v INT NOT NULL DEFAULT 0, route_len INT NOT NULL DEFAULT 0, route_n INT NOT NULL DEFAULT 0, route_name VARCHAR(120) NOT NULL DEFAULT '', route_pts MEDIUMTEXT NULL, ride_id CHAR(16) NULL, ride_started BIGINT NOT NULL DEFAULT 0, ride_by CHAR(24) NULL, ride_idle BIGINT NOT NULL DEFAULT 0, rec_bytes BIGINT NOT NULL DEFAULT 0, rec_full TINYINT NOT NULL DEFAULT 0, tick_at BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rgm (gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, at BIGINT NOT NULL, role VARCHAR(8) NOT NULL DEFAULT '', PRIMARY KEY (gid, uid)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rgx (gid CHAR(16) PRIMARY KEY, descr VARCHAR(255) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_pics (kind VARCHAR(8) NOT NULL, ref VARCHAR(24) NOT NULL, img MEDIUMTEXT NOT NULL, ver VARCHAR(12) NOT NULL DEFAULT '', at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (kind, ref)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_gp (id CHAR(16) PRIMARY KEY, gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL, mood VARCHAR(20) NOT NULL DEFAULT '', image CHAR(16) NOT NULL DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_gpl (post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, PRIMARY KEY (post, uid)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_gpc (id CHAR(16) PRIMARY KEY, post CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, text TEXT NOT NULL, at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rgrides (id CHAR(16) PRIMARY KEY, gid CHAR(16) NOT NULL, started BIGINT NOT NULL, ended BIGINT NOT NULL, sum MEDIUMTEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rgrec (id BIGINT AUTO_INCREMENT PRIMARY KEY, rideid CHAR(16) NOT NULL, line MEDIUMTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rgstat (rideid CHAR(16) NOT NULL, uname VARCHAR(40) NOT NULL, n INT NOT NULL DEFAULT 0, first_at BIGINT NOT NULL, last_at BIGINT NOT NULL, PRIMARY KEY (rideid, uname)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rglive (gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, sid CHAR(16) NOT NULL, lat DOUBLE NULL, lon DOUBLE NULL, acc INT NULL, spd DOUBLE NULL, est DOUBLE NULL, at BIGINT NOT NULL DEFAULT 0, rt_d DOUBLE NULL, rt_along DOUBLE NULL, rt_i INT NULL, fl VARCHAR(10) NULL, pend_f VARCHAR(10) NULL, pend_n INT NOT NULL DEFAULT 0, pend_m DOUBLE NOT NULL DEFAULT 0, PRIMARY KEY (gid, uid)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rts (sid CHAR(16) PRIMARY KEY, uid CHAR(24) NOT NULL, last BIGINT NOT NULL, created BIGINT NOT NULL, w_lat DOUBLE NULL, w_lon DOUBLE NULL, w_km DOUBLE NULL, w_fo TINYINT NOT NULL DEFAULT 0, w_key TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rtr (sid CHAR(16) NOT NULL, room VARCHAR(60) NOT NULL, skey TEXT NULL, PRIMARY KEY (sid, room)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_rte (id BIGINT AUTO_INCREMENT PRIMARY KEY, sid CHAR(16) NOT NULL, ev VARCHAR(40) NOT NULL, payload MEDIUMTEXT NOT NULL, at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_live (uid CHAR(24) PRIMARY KEY, sid CHAR(16) NOT NULL, name VARCHAR(40) NOT NULL, aud VARCHAR(10) NOT NULL, lat DOUBLE NULL, lon DOUBLE NULL, riding TINYINT NOT NULL DEFAULT 0, at BIGINT NOT NULL DEFAULT 0, seen TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_gvr (gid CHAR(16) PRIMARY KEY, mode VARCHAR(5) NOT NULL DEFAULT 'ptt', f_sid CHAR(16) NULL, f_uid CHAR(24) NULL, f_name VARCHAR(40) NULL, f_since BIGINT NOT NULL DEFAULT 0, f_until BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ml_gvp (sid CHAR(16) PRIMARY KEY, gid CHAR(16) NOT NULL, uid CHAR(24) NOT NULL, name VARCHAR(40) NOT NULL, mic TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx0 ON ml_posts(uid, at);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx1 ON ml_posts(at);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx2 ON ml_comments(post);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx3 ON ml_images(uid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx4 ON ml_friends(b);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx5 ON ml_requests(from_uid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx6 ON ml_requests(to_uid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx7 ON ml_msgs(pair, at);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx8 ON ml_rgm(uid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx9 ON ml_rgrides(gid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx10 ON ml_rgrec(rideid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx11 ON ml_rglive(sid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx12 ON ml_rts(uid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx13 ON ml_rtr(room);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx14 ON ml_rte(sid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx15 ON ml_gvp(gid);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx16 ON ml_rides(uid, started);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx17 ON ml_kv(exp);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx18 ON ml_gp(gid, at);
-- (zaten varsa 'Duplicate key name' hatası verir; yok sayılabilir)
CREATE INDEX mlx19 ON ml_gpc(post);

REPLACE INTO ml_kv (k, v, exp) VALUES ('schema', '4', 0);

-- Eski kurulumu yükseltiyorsan (v5): ALTER TABLE ml_rgm ADD COLUMN role VARCHAR(8) NOT NULL DEFAULT '';  (uygulama ilk istekte bunu kendisi de dener)
