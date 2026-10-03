// Real UI and API recording; no mocked routes or model responses.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const folder=process.env.DEMO_WORKSPACE || '/tmp/zenith-readme-demo/workspace';
 fs.mkdirSync(folder,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1100,height:720},recordVideo:{dir:'/tmp/lotus-project-video',size:{width:1100,height:720}}});
 const page=await context.newPage(); page.setDefaultTimeout(8000);
 try {
 await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:9563');
 await page.getByRole('button',{name:'开始使用',exact:true}).click();
 await page.waitForTimeout(900);
 await page.getByRole('button',{name:'管理项目',exact:true}).click();
 await page.waitForTimeout(900);
 await page.getByLabel('名称',{exact:true}).pressSequentially('Demo project',{delay:75});
 await page.getByLabel('主目录（绝对路径）',{exact:true}).pressSequentially(folder,{delay:40});
 await page.waitForTimeout(700);
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByText('Demo project',{exact:true}).waitFor();
 await page.waitForTimeout(1400);
 if (await page.getByRole('button',{name:'设为默认',exact:true}).count()) await page.getByRole('button',{name:'设为默认',exact:true}).click();
 await page.waitForTimeout(700);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'新建会话',exact:true}).click();
 await page.waitForTimeout(1600);
 await page.getByRole('button',{name:'切换为项目视图',exact:true}).click();
 await page.waitForTimeout(700);
 await page.getByTitle('选择项目',{exact:true}).click();
 await page.getByRole('menuitem',{name:'Demo project',exact:true}).click();
 await page.waitForTimeout(1600);
 await page.screenshot({path:path.join(__dirname,'project-workspace.png')});
 console.log(await page.locator('body').innerText());
 const projects=await (await page.request.get('http://127.0.0.1:9562/api/v1/projects')).json();
 if (!projects.projects.some(p=>p.name==='Demo project' && p.project_path===folder)) throw Error('Project not persisted by Bamboo');
 fs.writeFileSync(path.join(__dirname,'project-evidence.json'),JSON.stringify(projects,null,2)+'\n');
 const video=await page.video().path();
 await context.close(); await browser.close(); console.log('VIDEO='+video);
 } catch(error) {console.log(await page.locator('body').innerText()); await page.screenshot({path:'/tmp/lotus-demo-failure.png'}); await browser.close(); throw error;}
})().catch(error=>{console.error(error);process.exit(1)});
