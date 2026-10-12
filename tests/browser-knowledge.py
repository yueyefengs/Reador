# 由 browser-harness 执行；仅访问独立集成测试应用及合成数据。
import os, time, base64

context_id = cdp('Target.createBrowserContext', disposeOnDetach=True)['browserContextId']
try:
    book_id = os.environ['BROWSER_KNOWLEDGE_BOOK_ID']
    target_id = cdp('Target.createTarget', url='http://127.0.0.1:3114/?view=graph&book=' + book_id, browserContextId=context_id)['targetId']
    session_id = cdp('Target.attachToTarget', targetId=target_id, flatten=True)['sessionId']
    def command(method, **params):
        return cdp(method, session_id=session_id, **params)
    def evaluate(expression):
        result = command('Runtime.evaluate', expression=expression, returnByValue=True, awaitPromise=True)
        if result.get('exceptionDetails'):
            raise AssertionError('浏览器表达式失败：' + str(result['exceptionDetails']))
        return result['result'].get('value')
    def wait_until(predicate, message):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.2)
        raise AssertionError(message)
    def find_node(role, text):
        nodes = command('Accessibility.getFullAXTree')['nodes']
        return next((node for node in nodes if not node.get('ignored') and node.get('role', {}).get('value') == role and node.get('name', {}).get('value', '').startswith(text)), None)
    command('Page.bringToFront')
    command('Emulation.setFocusEmulationEnabled', enabled=True)
    def click(role, text):
        wait_until(lambda: find_node(role, text), '找不到界面元素：' + text)
        node = find_node(role, text)
        command('DOM.scrollIntoViewIfNeeded', backendNodeId=node['backendDOMNodeId'])
        time.sleep(0.15)
        box = command('DOM.getBoxModel', backendNodeId=node['backendDOMNodeId'])['model']['content']
        x, y = sum(box[0::2]) / 4, sum(box[1::2]) / 4
        command('Input.dispatchMouseEvent', type='mouseMoved', x=x, y=y)
        command('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
        command('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)
    def screenshot(path):
        data = command('Page.captureScreenshot', format='png', captureBeyondViewport=False)['data']
        with open(path, 'wb') as output:
            output.write(base64.b64decode(data))
    wait_until(lambda: evaluate("document.querySelector('input[type=email]')!==null"), '登录页未载入')
    click('textbox', '邮箱')
    command('Input.insertText', text='system@reador.local')
    click('textbox', '密码')
    command('Input.insertText', text='reador-test-password-A')
    click('button', '登录')
    wait_until(lambda: evaluate("document.body.innerText.includes('我的空间')"), '测试账号登录失败')
    click('DisclosureTriangle', '书籍知识点与学习路径')
    wait_until(lambda: evaluate("document.querySelectorAll('.knowledge-item').length>=2"), '知识点面板未载入')
    click('DisclosureTriangle', '核对理解缺口')
    wait_until(lambda: evaluate("document.querySelector('.knowledge-item[open]').innerText.includes('掌握标准')"), '掌握标准未展示')
    assert evaluate("document.querySelector('.knowledge-item[open]').innerText.includes('核对前先独立回忆')"), '先修依据未展示'
    screenshot('/tmp/reador-knowledge-desktop.png')
    # 以窄视口验证响应式布局；保留桌面指针，避免 Chrome 移动模拟的视口缩放影响输入坐标。
    command('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=1, mobile=False)
    assert evaluate('document.documentElement.scrollWidth<=window.innerWidth'), '知识点面板在移动端横向溢出'
    root = command('DOM.getDocument')['root']['nodeId']
    node_id = command('DOM.querySelector', nodeId=root, selector='.knowledge-item[open]')['nodeId']
    command('DOM.scrollIntoViewIfNeeded', nodeId=node_id, rect={'x': 0, 'y': 0, 'width': 300, 'height': 400})
    time.sleep(0.15)
    screenshot('/tmp/reador-knowledge-mobile.png')
    command('Page.navigate', url='http://127.0.0.1:3114/?view=reviews&book=' + book_id)
    wait_until(lambda: evaluate("document.body.innerText.includes('继续未完成的作答')"), '复习页未载入')
    click('button', '核对理解缺口检查')
    wait_until(lambda: evaluate("document.querySelector('.study-dialog .feedback-points')?.innerText.includes('说明顺序')===true"), '参考评分要点未载入')
    click('button', '查看补救建议')
    wait_until(lambda: evaluate("document.querySelector('.remedial-recommendations')?.innerText.includes('尚无独立作答证据')===true"), '补救建议未区分未检测知识点')
    assert evaluate('document.documentElement.scrollWidth<=window.innerWidth'), '补救建议在移动端横向溢出'
    screenshot('/tmp/reador-remedial-mobile.png')
    click('button', '针对这个基础知识练习')
    wait_until(lambda: evaluate("document.querySelector('.study-dialog').innerText.includes('讲解后的再次测试')&&document.querySelector('.study-dialog textarea')!==null"), '先修补救练习未进入作答状态')
    print('浏览器验证通过：隔离登录、知识点标准与先修依据、390px 布局、补救建议及先修练习入口。')
except Exception:
    screenshot('/tmp/reador-knowledge-qa-failure.png')
    print(evaluate("document.querySelector('.study-dialog')?.innerText||document.body.innerText"))
    raise
finally:
    cdp('Target.disposeBrowserContext', browserContextId=context_id)
