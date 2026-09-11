/* estimation.mock.js — ITA 接口模拟数据（外网/本机调试用）
 * ─────────────────────────────────────────────────────────
 * 仅当 URL 带 ?itaMock=1 时生效（文件常驻加载，自检参数，默认零行为）。
 * 零侵入：不修改 estimation.js / estimation.render.js，通过包装 window.fetch
 * 拦截 ita.abc 域请求返回模拟报文；去掉 URL 参数即为原始行为。
 *
 * 覆盖接口：
 *   searchProj2022.action   项目搜索（名称/编号关键字过滤，支持 on-the-fly 高频调用）
 *   searchProj.action       项目详情 + 文档列表（fileList，仅估算书/需求书两类相关命名）
 *   downloadFileById.action 文件下载（返回真实可解析文件：估算书 = SheetJS 现场生成的
 *                           合法 xlsx；需求书 = 预置的最小合法 docx——mock 全链路可跑到检查步骤）
 */
(function () {
  'use strict';

  function enabled() {
    try {
      return new URLSearchParams(window.location.search).get('itaMock') === '1';
    } catch (e) { return false; }
  }
  if (!enabled()) return;

  var PROJECTS = [
    { prjid: 'P20260001', projname: '新一代核心账务系统升级', projectno: 'XRK2026001', projtype: '开发类', status: '运行中' },
    { prjid: 'P20260002', projname: '手机银行客户体验优化', projectno: 'XRK2026002', projtype: '优化类', status: '运行中' },
    { prjid: 'P20260003', projname: '智能风控平台二期', projectno: 'XRK2026003', projtype: '开发类', status: '已结项' },
    { prjid: 'P20260004', projname: '数据中台治理专项', projectno: 'XRK2026004', projtype: '治理类', status: '已结项' },
    { prjid: 'P20260005', projname: '渠道整合平台三期', projectno: 'XRK2026005', projtype: '开发类', status: '运行中' },
    { prjid: 'P20260006', projname: '反洗钱监测能力建设', projectno: 'XRK2026006', projtype: '开发类', status: '运行中' },
  ];

  function est(name) {
    return { idFile: 'F-' + name, idPsn: 'U01', userName: '张甲', namFile: name + '_规模估算书_v2.3.xlsx', fileSize: 48213, timeUpl: '2026-08-30 10:21:44' };
  }
  function req(name, batch, b64) {
    return { idFile: 'F-' + name + '-' + batch, idPsn: 'U02', userName: '李乙', namFile: name + '需求说明书_批次' + batch + '.docx', fileSize: 15628, timeUpl: '2026-09-02 14:05:12', b64: b64 };
  }
  var FILES = {
    // P20260001：覆盖筛选规则的演示组合——多版本估算书（仅显最新 v2.3）、
    // 需求书 part1/part2（仅显 part1）、接口需求书（无 part 编号照常保留）、其他类型过滤
    P20260001: [
      { idFile: 'F-EST-V22', idPsn: 'U01', userName: '张甲', namFile: '新一代核心账务系统升级_规模估算书_v2.2.xlsx', fileSize: 48213, timeUpl: '2026-08-01 10:20:00' },
      { idFile: 'F-EST-V23', idPsn: 'U02', userName: '李乙', namFile: '新一代核心账务系统升级_规模估算书_v2.3.xlsx', fileSize: 50101, timeUpl: '2026-09-01 14:30:00' },
      { idFile: 'F-REQ-P1', idPsn: 'U02', userName: '李乙', namFile: '核心账务升级业务需求书part1.docx', fileSize: 15628, timeUpl: '2026-09-02 09:00:00', b64: '@@req1' },
      { idFile: 'F-REQ-P2', idPsn: 'U02', userName: '李乙', namFile: '核心账务升级业务需求书part2.docx', fileSize: 14210, timeUpl: '2026-09-02 09:05:00', b64: '@@req1' },
      { idFile: 'F-REQ-API', idPsn: 'U03', userName: '赵丙', namFile: '核心账务升级接口需求书.docx', fileSize: 9800, timeUpl: '2026-09-03 16:12:00', b64: '@@req1' },
      { idFile: 'F004', idPsn: 'U04', userName: '钱丁', namFile: '概要设计说明书_v1.1.docx', fileSize: 220450, timeUpl: '2026-07-11 11:00:00' },
      { idFile: 'F005', idPsn: 'U03', userName: '孙戊', namFile: '测试报告_季度汇总.xlsx', fileSize: 88210, timeUpl: '2026-09-05 16:40:31' },
    ],
    P20260002: [
      est('手机银行客户体验优化'),
      req('手机银行优化', 1, '@@req6'),
      { idFile: 'F104', idPsn: 'U04', namFile: '体验优化会议纪要.docx', fileSize: 30411, timeUpl: '2026-09-06 11:02:18' },
    ],
    P20260003: [
      est('智能风控平台二期'),
      req('风控平台二期', 1, '@@req3'), req('风控平台二期', 2, '@@req4'), req('风控平台二期', 3, '@@req5'),
    ],
    P20260004: [
      { idFile: 'F400', idPsn: 'U05', namFile: '数据治理工作方案.docx', fileSize: 91200, timeUpl: '2026-07-21 09:00:00' },
    ],
    P20260005: [
      est('渠道整合平台三期'),
      req('渠道整合三期', 1, '@@req7'),
    ],
    P20260006: [
      est('反洗钱监测能力建设'),
      req('反洗钱建设', 1, '@@req8'),
      { idFile: 'F603', idPsn: 'U06', namFile: '外部监管文件汇编.pdf', fileSize: 503288, timeUpl: '2026-09-01 08:55:00' },
    ],
  };

  var DOCX_B64 = {
    req1: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl1sogwZ4QEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4HA5WqCgG5Req9eQAXuwkS/pHthubmQChJwCgqSYjyU0oSDFIjIBWl2DjiYdg/TrxC13GrVlGlkMusduabb+ab2U2ufpRzYEvSjayqpLhYJMoBScmoYlbZSHHrb9dWXnPAMAVFFHKqIqW4bcngVtMvkvmEqGY+yJJiAsagGIl8its0TS3B80ZmU5IFI6JqksJi71VdFkx21Tf4vKqLmq5mJMNgBeQcH49GX/GykFW4NKN8p4rbwakFRg+MmY6B+YWF7wrYKdDpIMkHvsDqD1Z7DMcXt/ikDCcjOPZmVhV/HaNpkQ4ddNBCdpl4nZllz1suOe+Rs92QmfaH+LQGXWfh7+F9F9+2Ygt/f+FXyVEXejXa2cXdFvQHpNdgIHS4F3iuLdxsMwoWwpUmPh5guzezCk/2FwfooEmL92Hpp+GRGPjdU5hHq0V0PlxqDA9pqFpCh9/CXFJwaaWN3O9MGyr9hPd1OGk/ksfGhsqfllISiYP55ZdnycFWJ9Dg7DDwwj9jI6T9K3I3gd4NPq2juo28I9wYzRtDOLbpqESnZRAHpPN5mYZeAuI5+LIZ7vNZL+XfLbLhwEkp3D1YfwPguIZ/7JBuhQ6KtH/8/074P4+X//sx0r8AUEsBAhQDFAAAAAgA3FAqXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADcUCpdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADcUCpdbKIMGeEBAABdAwAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA/wMAAAAA",
    req2: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl38VyhG4QEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4XgytVFQJyi9R78wAudhMk/CPbLc3NgVCSgFFUkhDlp5S0GKRGQCpKsXHEw7B/nHiFruNWraJKIZdZ7cw338w3s5tae6/kwTvZMHOamuYSsTgHZDWrSTl1M81tvFp/+oIDpiWqkpjXVDnNbcsmt5Z5kiokJS37VpFVCzAG1UwW0tyWZelJnjezW7IimjFNl1UWe6MZimixq7HJFzRD0g0tK5smK6DkeSEef84rYk7lMozytSZth6ceGiM0ViYBFhc2vilit0hnwxQf+kJr3Fn9PhxfXOOTCpyO4cSf2zX8eYJmJTpy0UEbORXid+e2s2h75LxPznYjZjoY4dM69NxlsIf3PXzdFpbB/jKokaMe9Ou0u4t7bRgMSb/JQOhwL/R8sXGrwyhYCFdb+HiInf7cLj7YnwDQQYuWbqPSD8NjCfC7pyiP1krofLTSGO7SUK2MDr9FuaTo0WoHed+ZNlT+CW8bcNq5J4+NDVU+rKQkJoDF5adHycF2N9Tg7jDwMjhjI6SDK3Izhf5XfNpADQf5R7g5XjRHcOLQcZnOKkAApPtxlYaeAeK7+LIV7fNRL+XfLbLhwGk52j3YeAngpI5/7JBelQ5LdHD8/074P4+X//sxMr8AUEsBAhQDFAAAAAgA3FAqXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADcUCpdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADcUCpd/FcoRuEBAABdAwAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA/wMAAAAA",
    req3: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl0Afc1H4gEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4HA5WqCgG5Vcq9eQAXuwkS/pHtlubmQChJMW5UkhIlpBZN+ZEagdNSio2jPAy76/WJV+g6btUqqhRymdXOfPPNfDO72fU3Ygm8FlStKEs5JpVIMkCQCjJflLZyzObzZ2tPGaDpnMRzJVkScsyOoDHr+UfZcoaXC69EQdIBZZC0TDnHbOu6kmFZrbAtiJyWkBVBorGXsipyOr2qW2xZVnlFlQuCptECYolNJ5NPWJErSkyeUr6Q+Z3oVCKjRkbPp0DYMfBVBfcr5MbJspEvsuqtVe7CcecSf6zD+RTOvIVhhhcWtgbI/Y7eO9AzccdeGM2w6wZno+B0L2Ym4wk+saDbX/r7+MDFl93U0j9Y+mZwNISeRQZ7eNiFvhOM2hSEDvcjz4WB7R6loCHcsPGxg5ujhVG5t780QO9sUr2OS98PT6TA757iPGJW0dlkpTHcpiGzhg6/xrlBxSWNHnK/UW2o9hNet+C8d0ceHRuqv11JSSINwvNPD5KDjUGkob9LwUv/lI6QjD8HV3PofcEnLdRqIu8It6dhewJnTTKtkZs6SINg8GGVhh6DwOvjczve54Neyr9bpMOB81q8e7C5AeDMwj92g2GDOFUyPv5/J+yfx8v+/Rj5X1BLAQIUAxQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAAAAAAAAAAAAAIABGQEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgA3FAqXQB9zUfiAQAAXQMAABEAAAAAAAAAAAAAAIAB7wEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAAAEAAAAAA==",
    req4: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl2QiOkY4gEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4HgytVFQJyq5R78wAUuwkS/pHtlubmQChJMW5UkhIlpBZN+ZEagdNSio2jPAy76/WJV+g6btUqqhRymdXOfPPNfDO7mfU3Ygm8FlStKEtZJpVIMkCQCjJflLayzObzZ2tPGaDpeYnPl2RJyDI7gsas5x5lymleLrwSBUkHlEHS0uUss63rSppltcK2IOa1hKwIEo29lFUxr9OrusWWZZVXVLkgaBotIJZYLpl8wor5osTkKOULmd+JTiUyamT0XAqEHQNfVXC/Qm6cDBv5IqveWuUuHHcu8cc6nE/hzFsYZnhhYWuA3O/ovQM9E3fshdEMu25wNgpO92JmMp7gEwu6/aW/jw9cfNnllv7B0jeDoyH0LDLYw8Mu9J1g1KYgdLgfeS4MbPcoBQ3hho2PHdwcLYzKvf1xAL2zSfU6Ln0/PJECv3uK84hZRWeTlcZwm4bMGjr8GucGFZc0esj9RrWh2k943YLz3h15dGyo/nYlJQkOhOefHiQHG4NIQ3+Xgpf+KR0hGX8OrubQ+4JPWqjVRN4Rbk/D9gTOmmRaIzd1wIFg8GGVhh6DwOvjczve54Neyr9bpMOB81q8e7C5AeDMwj92g2GDOFUyPv5/J+yfx8v+/Ri5X1BLAQIUAxQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAAAAAAAAAAAAAIABGQEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgA3FAqXZCI6RjiAQAAXQMAABEAAAAAAAAAAAAAAIAB7wEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAAAEAAAAAA==",
    req5: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl3g2/Ut4wEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4XA5GqCgG5Veq9eQAXuwkS/pHtlubmQChJMW5UkhAlpBZN+ZEagdNSio2jPAy76/WJV+g6btUqqhRymdXOfPPNfDO72fW3Ygm8EVStKEs5JpVIMkCQCjJflDZzzMaLZ4+fMkDTOYnnSrIk5JhtQWPW84+y5QwvF16LgqQDyiBpmXKO2dJ1JcOyWmFLEDktISuCRGOvZFXkdHpVN9myrPKKKhcETaMFxBKbTiafsCJXlJg8pXwp89vRqURGjYyeT4GwY+CrCu5XyI2TZSNfZNVbq9yF484lPq7D+RTOvIVhhhcWtgbI/Y4+ONAzccdeGM2w6wZno+B0N2Ym4wk+saDbX/p7eN/Fl921pb+/9M3gcAg9iwx28bALfScYtSkIHexFngsD2z1KQUO4YeMjBzdHC6Nyb39pgN7bpHodl74fnkiB3z3FecSsorPJSmO4TUNmDR18jXODiksaPeR+o9pQ7Se8bsF57448OjZUf7eSkkQahOefHiQHG4NIQ3+Hgpf+KR0hGX8OrubQ+4JPWqjVRN4hbk/D9gTOmmRaIzd1kAbB4OMqDa2BwOvjczve54Neyr9bpMOB81q8e7DxHMCZhX/sBMMGcapkfPT/Ttg/j5f9+zHyvwBQSwECFAMUAAAACADcUCpdeW4z1+gAAACtAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIANxQKl2b/TfqrQAAACkBAAALAAAAAAAAAAAAAACAARkBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIANxQKl3g2/Ut4wEAAF0DAAARAAAAAAAAAAAAAACAAe8BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAABBAAAAAA=",
    req6: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl2/Nf3S4QEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4XA5WqCgG5Veq9eQAXuwkS/pHtlubmQCihGBSVJKCEFNGWH6kRkIpSbBzlYdgdLydeoeu4VauoUshlVjvzzTfzzewmt97JOfRW0o2sqqS4WCTKIUnJqGJW2Ulx2y+fP37GIcMUFFHIqYqU4vYkg9tKP0rmE6KaeSNLiokYg2Ik8ilu1zS1BM8bmV1JFoyIqkkKi71WdVkw2VXf4fOqLmq6mpEMgxWQc3w8Gn3Ky0JW4dKM8pUq7gWnFhg9MGY6hlZtC64K0C/Qm0mSD3yB1W+tdhcO7Us4LePFDM/dpWVDpQptd9WY0a6NvRaxT5dWbdV1/PORf3YQMtPxFFp17PTX3iFUHLjsxtZeZe3Z/vEQu3U6OIBhF3sTf9RkIHJ0GHi+WNDpMQoWgmoHTiZQGy2twr39xRH50KHF67D0/fBIDP3uKcyjdpGcTzcaw20asUvk6FuY6xccWu0R5zvTRko/8XUDL3p35LGxkfL7jZRE4mh18elBcsAaBBr6+wy89s7YCOn4s3+1wO5XaDVIo0bcY2jOVs0pntforERvyiiO/MHHTRp6gny3DxedcJ8Pein/bpENBy9K4e7R9guE53X4se8Pq3RSpOOT/3fC/3m8/N+Pkf4FUEsBAhQDFAAAAAgA3FAqXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADcUCpdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADcUCpdvzX90uEBAABdAwAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA/wMAAAAA",
    req7: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl3+sCji4QEAAF0DAAARAAAAd29yZC9kb2N1bWVudC54bWyVU81u2kAQvvcpVr4XA5WqCgG5Req9eQAXuwkS/pHtluZmIJRQfhSVUKKE1KUpP1IjIBWltnGUh2E9Xk68Qtdxq1ZRpZDLrHbmm2/mm9lNbr0Vc+iNoGpZWUoxsUiUQYKUkfmstJtidl5sP37GIE3nJJ7LyZKQYvYFjdlKP0rmE7yceS0Kko4og6Ql8ilmT9eVBMtqmT1B5LSIrAgSjb2SVZHT6VXdZfOyyiuqnBE0jRYQc2w8Gn3KilxWYtKU8qXM7wenEhg1MHo6hlZdA66KMCiSm2mSDXyBVW+tchcO3Uv4WMGLObacpVEH6/Oq0IL2zDs6xFYVuubSaKx6tn829k8PQmYymcFJE9uDtXsIVRsue7G1W127df94hJ0mGR7AqIfdqT/uUBAlCjwXBph9SkFDUDOhPYXGeGkU7+0vjrz3Jildh6Xvh0di6HdPYR6pl7yz2UZjuE3z6mXv6FuY6xdtUut79neqzSv/xNctvOjfkUfH5lXebaQkEker808PkgPGMNAwKFDw2j2lIySTL/7VAjtf4aTltRqecwyd+aozw1aDzMvkpoLiyB9+2KShJ8h3BnBuhvt80Ev5d4t0OHhRDnePdp4jbDXhR8Ef1ci0RCbt/3fC/nm87N+Pkf4FUEsBAhQDFAAAAAgA3FAqXXluM9foAAAArQEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADcUCpdm/036q0AAAApAQAACwAAAAAAAAAAAAAAgAEZAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADcUCpd/rAo4uEBAABdAwAAEQAAAAAAAAAAAAAAgAHvAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA/wMAAAAA",
    req8: "UEsDBBQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIANxQKl1lHokM3wEAAFoDAAARAAAAd29yZC9kb2N1bWVudC54bWyVU1tvElEQfvdXnOy7LGBiDAH61sR3+wNWdm1J2Et2V7FvWyjSCotNaaXpRUKVS2LDxSCyl9ofw7ntE3/Bs12NpjEpfZmTM/PNN/PNnJNeeysXwBtJN/KqkuESsTgHJCWninllM8NtvFh//IwDhikoolBQFSnDbUsGt5Z9lC6mRDX3WpYUEzAGxUgVM9yWaWopnjdyW5IsGDFVkxQWe6XqsmCyq77JF1Vd1HQ1JxkGKyAX+GQ8/pSXhbzCZRnlS1XcDk8tNHpozGwCBOcWnpRwr0Rvxmk+9IVWv7XaXTg+v8Ifq9Cbwbm7sOrog42nreBwgjyXDn8uLDvoOORsSE53I1o6muKTBnR6S38P7zv4qpNY+vtLv06OBtBt0P4uHnSgPybDFgOhg73Q89nC7S6jYCFca+PjMbaHC6t0b3NJgN63afk6Kn0/PJYAv3uK8mi9jM6mK83gNg3VK+jga5RLSg6tdZHzjWlDlR/wugm97h15bGao+m4lJbEkCC4+PUgOtvqhht4OAy/9UzZCOrokEw+6X/BJEzVt5B7h1ixoTeHcprMKvamCJCD9w1UaegKI28MX7WifD3om/26RDQd6lWj3YOM5gPMG/r5DBjU6LtPR8f874f+8XP7vr8j+AlBLAQIUAxQAAAAIANxQKl15bjPX6AAAAK0BAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgA3FAqXZv9N+qtAAAAKQEAAAsAAAAAAAAAAAAAAIABGQEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgA3FAqXWUeiQzfAQAAWgMAABEAAAAAAAAAAAAAAIAB7wEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAP0DAAAAAA==",
  };

  // idFile → 文件索引（下载接口只带 idFile，需反查类型）
  var IDMAP = {};
  Object.keys(FILES).forEach(function (prjid) {
    FILES[prjid].forEach(function (f) { IDMAP[f.idFile] = f; });
  });

  function jsonResp(obj) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  /** 生成合法的估算书 xlsx（SheetJS 现场构建，sheet 名符合 SDC######_#### 规则） */
  function buildEstimationXlsx(name) {
    var wb = window.XLSX && window.XLSX.utils
      ? window.XLSX.utils
      : null;
    if (!wb) {
      return new Response('mock-xlsx-unavailable', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    }
    var U = window.XLSX.utils;
    var rows = [
      ['功能点编号', '功能点名称', '功能点描述', '功能类型', '操作角色', '批量处理', '备注'],
      ['GN-001', '账户开户', '受理客户开户申请，校验客户身份信息，创建账户档案', ' transaction', '柜员', '否', ''],
      ['GN-002', '账户查询', '按账号查询账户余额与明细，支持近两年交易流水', '查询', '柜员/客户', '否', ''],
      ['GN-003', '转账汇款', '行内转账与跨行汇款，含大额交易风控校验', '交易', '客户', '否', ''],
      ['GN-004', '批量代发', '企业批量代发工资文件导入，校验并生成代发指令', '交易', '企业用户', '是', ''],
      ['GN-005', '对账单下载', '生成并下载电子对账单，支持 PDF 与 Excel 格式', '查询', '企业用户', '否', ''],
    ];
    var ws = U.aoa_to_sheet(rows);
    var wbk = U.book_new();
    U.book_append_sheet(wbk, ws, 'SDC202601_0101');
    var buf = window.XLSX.write(wbk, { bookType: 'xlsx', type: 'array' });
    return Promise.resolve(new Response(buf, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
  }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!origFetch) return;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    if (url.indexOf('ita.abc') < 0) return origFetch(input, init);

    // 项目搜索（searchProj2022）
    if (url.indexOf('searchProj2022.action') >= 0) {
      var body = (init && init.body) || '';
      var kw = '';
      try {
        kw = decodeURIComponent((body.match(/projname=([^&]*)/) || ['', ''])[1]) || '';
      } catch (e) { kw = ''; }
      var list = PROJECTS.filter(function (p) {
        return !kw || p.projname.indexOf(kw) >= 0 || p.projectno.indexOf(kw) >= 0;
      });
      return jsonResp({ data: list });
    }

    // 项目详情 + 文档列表（searchProj）
    if (url.indexOf('searchProj.action') >= 0) {
      var b2 = (init && init.body) || '';
      var prjid = (b2.match(/prjid=([^&]*)/) || ['', ''])[1];
      var proj = PROJECTS.filter(function (p) { return p.prjid === prjid; })[0] || {};
      return jsonResp({ data: [{ prjid: prjid, projname: proj.projname, projectno: proj.projectno, projtype: proj.projtype, status: proj.status, fileList: FILES[prjid] || [] }] });
    }

    // 文件下载：真实可解析文件
    if (url.indexOf('downloadFileById.action') >= 0) {
      var id = (url.match(/idFile=([^&]*)/) || ['', ''])[1];
      var f = IDMAP[decodeURIComponent(id)];
      if (f && /\.xlsx$/i.test(f.namFile)) return buildEstimationXlsx(f.namFile.replace(/_规模估算书.*$/, ''));
      if (f && f.b64 && DOCX_B64[String(f.b64).replace(/^@@/, '')]) {
        var b64key = String(f.b64).replace(/^@@/, '');
        var raw = atob(DOCX_B64[b64key]);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return Promise.resolve(new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        }));
      }
      // 其他类型（本模块确认表已过滤，一般不会请求）：占位字节
      return Promise.resolve(new Response('mock-file-bytes', {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    }

    return origFetch(input, init);
  };

  console.log('[estimation.mock] ITA 模拟数据已启用（?itaMock=1），共 ' + PROJECTS.length + ' 个模拟项目；下载返回真实可解析文件');
})();
