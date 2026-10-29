---
layout: post
title: "После прочтения сжечь"
description: "Делаем одноразовые ссылки на голом Nginx"
date: 2018-01-16 12:00:00 +0000
---

Для начала нужно уточнить, что я настоятельно не рекомендую использовать это решение в боевых условиях. Лучше вовсе так не делать никогда. Всё, что вы делаете, вы делаете на свой страх и риск. Причины, которые заставляют дать такой совет, будут приведены в содержании статьи.

Под «голым Nginx» понимается пакет для Ubuntu 16.04 из mainline ветки [официального репозитория](https://nginx.ru/ru/linux_packages.html#mainline), который уже собран с ключом `--with-http_dav_module`. Предполагается, что у вас уже есть настроенный nginx в такой же «комплектации», следовательно, ниже будет описываться лишь настройка нескольких location, которые вы добавите в свою секцию server конфига nginx. В моём случае все временные файлы будут храниться в папке `/var/www/upload` по пути вида `/random_folder_name/filename`, где в качестве `random_folder_name` будет рандомная строка из нужного нам количества байт, потому создаём location вида:

```nginx
location ~ ^/upload/([\w]+)/([^/]*)?$ {
    root /var/www;
    if ($request_method !~ ^(PUT|DELETE)$) {
        return 444;
    }
    client_body_buffer_size 2M;
    client_max_body_size 1G;
    dav_methods PUT DELETE;
    dav_access group:rw all:r;
    create_full_put_path on;
}
```

Проверяем, что загрузка и удаление файлов и папок работает командами в консоли:

```bash
$ curl -X PUT -T test.txt https://example.com/upload/random_folder_name/
$ curl -X DELETE https://example.com/upload/random_folder_name/
```

Для того, чтобы оградить свой сервер от неконтролируемого потока загружаемых файлов, добавим проверку токена, который мы будем передавать заголовком `Token`. В конфиге это будет выглядеть следующим образом:

```nginx
if ($http_token != "cb110ef4c4165e495001e297feae7092") {
    return 444;
}
```

Сам токен можно сгенерировать в консоли командой вида:

```bash
$ hexdump -n 16 -e '/4 "%x"' </dev/urandom
```

Снова проверяем, командами в консоли, что загрузка и удаление файлов и папок работает, но только при наличии в запросе заголовка `Token`:

```bash
$ curl -X PUT -H "Token: cb110ef4c4165e495001e297feae7092" -T test.txt https://example.com/upload/random_folder_name/
$ curl -X DELETE -H "Token: cb110ef4c4165e495001e297feae7092" https://example.com/upload/random_folder_name/
```

Загружать и удалять файлы мы научились, но для того, чтобы скачивать файлы мы заведём отдельный location:

```nginx
location ~ ^/download/(?<folder>[\w]+)/([^/]*)$ {
    root /var/www;
    if ($request_method != GET) {
        return 444;
    }
    rewrite ^/download/([\w]+)/([^/]*)$ /upload/$1/$2 break;
}
```

Проверяем, что получение файлов работает командой в консоли:

```bash
$ curl https://example.com/download/random_folder_name/test.txt
```

Если тесты прошли успешно, то необходимо привести этот location к состоянию, удовлетворяющему нашим требованиям:

- Если единожды попросить у nginx файл, то он его закеширует и будет снова и снова его отдавать, даже если файл удалить с диска. Это не укладывается в нашу концепцию одноразовых ссылок, потому необходимо, следуя [инструкции](https://nginx.ru/ru/docs/http/ngx_http_core_module.html#open_file_cache) привести директиву `open_file_cache` к значению `off`:

```nginx
open_file_cache off;
```

- Для того, чтобы все файлы отдавались как аттачи, в том числе и html, необходимо их отдавать с заголовками `Content-Type: application/octet-stream` и `Content-Disposition: attachment`. А также, чтобы «умные» браузеры, например Internet Explorer, не могли переопределить content type на основе содержимого файла, нужен заголовок `X-Content-Type-Options: nosniff`. В конфиге это будет выглядеть следующим образом:

```nginx
types { }
default_type application/octet-stream;
add_header Content-Disposition "attachment";
add_header X-Content-Type-Options "nosniff";
```

Теперь мы научились загружать и безопасно получать, но нам нужно сделать так, чтобы они удалялись сразу после скачивания, а для этого мы заведём отдельный location:

```nginx
location @delete {
    proxy_method DELETE;
    proxy_set_header Token "cb110ef4c4165e495001e297feae7092";
    proxy_pass https://example.com/upload/$folder/;
}
```

И вызывать этот location мы будем из `location ~ ^/download/…` директивой `post_action @delete;`.

Выглядит вполне прилично, но я, как и писал выше, крайне не рекомендую использовать то, что [непонятно как работает и не задокументировано](https://forum.nginx.org/read.php?2,274880,274886#msg-274886). Именно поэтому я надеюсь, что никто не будет использовать это решение «в бою».

Теперь всё хорошо, ибо файлы мы можем загрузить, скачать, и после скачивания они удаляются, но полученные ссылки невозможно передавать в мессенджерах, т.к. боты делают запросы по этим ссылкам в надежде получить контент и сгенерировать превью, что приводит к тому, что файл сразу же удаляется, а получатель при переходе по ссылке наблюдает 404 вместо заветного файла. Для решения этой проблемы мы воспользуемся тем, что будем отправлять получателю не прямую ссылку на скачивание файла, а ссылку на промежуточную страницу, и сделаем это также только благодаря возможностям «коробочного» Nginx. Первым делом создаём ещё один location, который будет отдавать html-файл:

```nginx
location ~ ^/get/(?<folder>[\w]+)/(?<file>[^/]*)$ {
    root /var/www;
    ssi on;
    if ($request_method != GET) {
        return 444;
    }
    rewrite ^(.*)$ /download.html break;
}
```

Самое важное в этом location — директива «`ssi on;`». Именно с помощью [ngx_http_ssi_module](https://nginx.ru/ru/docs/http/ngx_http_ssi_module.html) мы будем отдавать динамический html, как бы странно эта фраза не звучала. Создаём в папке `/var/www` тот самый файл `download.html` с содержимым следующего вида:

```html
<html>
<body>
After downloading this data will be destroyed
<form action='/download/<!--# echo var="folder" -->/<!--# echo var="file" -->' method="get" id="download"></form>
<p><button type="submit" form="download" value="Submit">Download</button></p>
</body>
</html>
```

Теперь вместо того, чтобы отдавать прямую ссылку на скачивание вида `example.com/download/random_folder_name/filename`, мы будем передавать ссылку на промежуточную страницу. Ссылка на эту страницу будет выглядеть как `example.com/get/random_folder_name/filename`, при переходе на неё файл останется целым и невредимым, т.к. для его скачивания необходимо будет кликнуть на кнопку. А для большей уверенности, что боты не перейдут по ссылке с этой страницы, добавим в `location ~ ^/download/…` проверку заголовка Referer, чтобы файл отдавался только в том случае, если он действительно был скачан с промежуточной страницы:

```nginx
if ($http_referer !~ ^https://example\.com/get/([\w]+)/([^/]*)$) {
    return 444;
}
```

Итоговый конфиг в моём случае выглядит следующим образом:

```nginx
location ~ ^/upload/([\w]+)/([^/]*)?$ {
    root /var/www;
    if ($request_method !~ ^(PUT|DELETE)$) {
        return 444;
    }
    if ($http_token != "cb110ef4c4165e495001e297feae7092") {
        return 444;
    }
    client_body_buffer_size 2M;
    client_max_body_size 1G;
    dav_methods PUT DELETE;
    dav_access group:rw all:r;
    create_full_put_path on;
}

location ~ ^/get/(?<folder>[\w]+)/(?<file>[^/]*)$ {
    root /var/www;
    ssi on;
    if ($request_method != GET) {
        return 444;
    }
    rewrite ^(.*)$ /download.html break;
}

location ~ ^/download/(?<folder>[\w]+)/([^/]*)$ {
    root /var/www;
    open_file_cache off;
    types { }
    default_type application/octet-stream;
    add_header Content-Disposition "attachment";
    add_header X-Content-Type-Options "nosniff";
    if ($request_method != GET) {
        return 444;
    }
    if ($http_referer !~ ^https://example\.com/get/([\w]+)/([^/]*)$) {
        return 444;
    }
    rewrite ^/download/([\w]+)/([^/]*)$ /upload/$1/$2 break;
    post_action @delete;
}

location @delete {
    proxy_method DELETE;
    proxy_set_header Token "cb110ef4c4165e495001e297feae7092";
    proxy_pass https://example.com/upload/$folder/;
}
```

Чтобы теперь этим было удобно пользоваться и не вбивать в консоли длинные команды для загрузки файлов и папок, я набросал в `.zshrc` (предполагаю, что будет работать и в `.bashrc`) функцию:

```bash
upload() {
    if [ $# -eq 0 ]; then
        echo "Usage: upload [file|folder] [option]
              cat file | upload [name] [option]
              Options:
                gpg - Encrypt file. The folder is pre-packed to tar
                gzip - Pack to gzip archive. The folder is pre-packed to tar"
        return 1
    fi
    uri="https://example.com/upload"
    token="cb110ef4c4165e495001e297feae7092"
    random=$(hexdump -n 8 -e '/4 "%x"' </dev/urandom)

    if tty -s; then
        name=$(basename "$1")
        if [ "$2" = "gpg" ]; then
            passphrase=$(tr -dc "[:graph:]" </dev/urandom | head -c16)
            echo "$passphrase"
            if [ "$1" = "-" ]; then
                name=$(basename $(pwd))
                tar cf - `ls -1 $(pwd)` | gpg --passphrase-file <(echo -n "$passphrase") --batch -ac -o- | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.tar.gpg" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            elif [ -d "$1" ]; then
                tar cf - `ls -1 "$1"` | gpg --passphrase-file <(echo -n "$passphrase") --batch -ac -o- | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.tar.gpg" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            elif [ -f "$1" ]; then
                gpg --passphrase-file <(echo -n "$passphrase") --batch -ac -o- "$1" | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.gpg" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            fi
        elif [ "$2" = "gzip" ]; then
            if [ "$1" = "-" ]; then
                name=$(basename $(pwd))
                tar czf - `ls -1 $(pwd)` | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.tar.gz" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            elif [ -d "$1" ]; then
                tar czf - `ls -1 "$1"` | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.tar.gz" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            elif [ -f "$1" ]; then
                gzip -c "$1" | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.gz" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            fi
        else
            if [ "$1" = "-" ]; then
                name=$(basename $(pwd))
                tar cf - `ls -1 $(pwd)` | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.tar" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            elif [ -d "$1" ]; then
                tar cf - `ls -1 "$1"` | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$name.tar" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            elif [ -f "$1" ]; then
                curl -I --progress-bar -H "Token: $token" -T "$1" "$uri/$random/$name" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
            fi
        fi
    else
        if [ "$2" = "gpg" ]; then
            passphrase=$(tr -dc "[:graph:]" </dev/urandom | head -c16)
            echo "$passphrase"
            gpg --passphrase-file <(echo -n "$passphrase") --batch -ac -o- | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$1.gpg" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
        elif [ "$2" = "gzip" ]; then
            gzip | curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$1.gz" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
        else
            curl -I --progress-bar -H "Token: $token" -T "-" "$uri/$random/$1" | grep "Location: " | cut -d " " -f2 | sed "s'/upload/'/get/'g"
        fi
    fi
}
```

Минусы этого решения:
- Использование недокументированной директивы `post_action`, которую использовать нельзя
- Нет докачки. Если оборвалось соединение, то nginx исполнит директиву `post_action` и удалит файл
- Всё это выглядит как магия

P.S.: Выражаю благодарность [el777](https://habrahabr.ru/users/el777/), т.к. его [совет](https://habrahabr.ru/post/346758/#comment_10620084), привёл к тому, что на меня снизошло дополнительное озарение, и конфиги со статьёй были переписаны.

P.P.S.: Для тех, кто не боится использовать подобное решение в боевых условиях, есть [готовое решение](https://github.com/KPEBETKA/burn-after-reading), работоспособность которого можно проверить [тут](https://burnafterreading.kpebetka.net/)