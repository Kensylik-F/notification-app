<#--
  Free-form message written in the notifications-kit editor. The body arrives as an HTML fragment
  the kit has already cleaned (whitelisted tags, http/https/mailto links only); this template does
  not escape it on purpose. Only senders with NOTIFICATION_SENDER / NOTIFICATION_ANNOUNCER can
  supply it.
-->
<html lang="${locale}">
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1b2524;">
${bodyHtml}
</body>
</html>
