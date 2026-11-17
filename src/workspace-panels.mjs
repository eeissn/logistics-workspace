import {archived,etrnStatus,orderMargin,tripStatus} from './domain.mjs';
import {routeText} from './registry.mjs';
import {etrnTimeline,financialFlags,flagLabels,monthlyComparison,tripTimeline} from './workspace-insights.mjs';

const element = (tag,text,cls) => {
  const node=document.createElement(tag);
  if(text!=null)node.textContent=text;
  if(cls)node.className=cls;
  return node;
};
const money = value => value == null ? '—' : new Intl.NumberFormat('ru-RU',{
  style:'currency',currency:'RUB',maximumFractionDigits:0
}).format(value);

export function mountWorkspacePanel({root,getOrder,edit,openEtrn,openDriver,openContacts}) {
  let selected;
  const close=()=>{root.hidden=true;selected=null;document.body.classList.remove('workspace-peek-open');};
  const open=number=>{
    const order=getOrder(number);
    if(!order)return;
    selected=number;
    root.replaceChildren();
    const top=element('header',null,'peek-header');
    top.append(element('h2','Заявка № '+order.number));
    const closeButton=element('button','×','peek-close');
    closeButton.type='button'; closeButton.setAttribute('aria-label','Закрыть карточку');
    closeButton.addEventListener('click',close);
    top.append(closeButton);
    root.append(top);
    const context=element('div',null,'peek-context');
    const details=element('section',null,'peek-context-panel');
    details.append(element('h3',routeText(order)||'Маршрут не указан'));
    for(const [title,value] of [
      ['Заказчик',order.customer],['Перевозчик',order.carrier],
      ['Водитель',order.driver],['Транспорт',order.vehicle],
      ['Груз',order.cargo],['Дата заявки',order.date],
      ['Ставка заказчика',money(order.customerAmount)],
      ['Ставка перевозчика',money(order.carrierAmount)],
      ['Маржа',money(orderMargin(order))],
    ]) {
      const row=element('div',null,'peek-field');
      row.append(element('small',title),element('span',value||'—'));
      details.append(row);
    }
    const points=element('section',null,'peek-context-panel');
    points.append(element('h3','Точки и документы'));
    for(const point of order.points||[]) {
      const entry=element('p',null,'peek-point');
      entry.append(element('strong',point.kind+' · '),
        document.createTextNode(point.address||'Адрес не указан'));
      if(point.schedule)entry.append(element('small',point.schedule));
      points.append(entry);
    }
    if(!order.points?.length)points.append(element('p','Точки не указаны','quiet'));
    points.append(element('p','Исходные PDF не хранятся в реестре. Для просмотра нужен безопасный источник файлов.','quiet'));
    const etrn=element('section',null,'peek-context-panel');
    etrn.append(element('h3','ЭТРН · '+etrnStatus(order.etrn)));
    if(order.etrn?.number)etrn.append(element('p','Номер: '+order.etrn.number));
    const timeline=(title,items)=>{
      const section=element('section',null,'peek-timeline');
      section.append(element('h4',title));
      const list=element('ol');
      for(const item of items) {
        const li=element('li',item.title);
        li.dataset.state=item.state;
        if(item.state==='current')li.setAttribute('aria-current','step');
        list.append(li);
      }
      section.append(list);return section;
    };
    etrn.append(timeline('Рейс',tripTimeline(order)),timeline('Документ',etrnTimeline(order)));
    const actions=element('div',null,'peek-actions');
    for(const [title,callback] of [
      ['Открыть заявку',()=>{close();edit(number);}],
      ['Данные водителя',()=>{close();openDriver(number);}],
      ['ЭТРН',()=>{close();openEtrn(number);}],
      ['Контакты',()=>{close();openContacts(number);}]
    ]) {
      const button=element('button',title);
      button.type='button';
      button.addEventListener('click',callback);
      actions.append(button);
    }
    root.append(context,actions);
    context.append(details,points,etrn);
    const flags=financialFlags(order);
    if(flags.length) {
      const alert=element('p',flags.map(flag=>flagLabels[flag]).join(' · '),'peek-alert');
      details.append(alert);
    }
    root.hidden=false;
    document.body.classList.add('workspace-peek-open');
    closeButton.focus({preventScroll:true});
  };
  root.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  return {open,close,selected:()=>selected};
}
export function mountComparison({dialog,orders,first,second,results}) {
  const render=()=>{
    const {before,after,delta,percent}=monthlyComparison(orders(),first.value,second.value);
    results.replaceChildren();
    const table=element('div',null,'comparison-metrics');
    for(const [title,a,b] of [
      ['Заявок',String(before.count),String(after.count)],
      ['Рассчитана маржа',String(before.calculated),String(after.calculated)],
      ['Всего маржи',money(before.total),money(after.total)],
      ['Средняя маржа',money(before.average),money(after.average)],
      ['Медианная маржа',money(before.median),money(after.median)],
      ['Финансовые предупреждения',String(before.issues),String(after.issues)],
    ]) {
      const row=element('div',null,'comparison-row');
      row.append(element('strong',title),element('span',a),element('span',b));
      table.append(row);
    }
    results.append(table,element('p',
      'Изменение маржи: '+money(delta)+
      (percent==null?' (процент недоступен без базовой суммы)':
      ' · '+percent.toFixed(1)+'%'),'comparison-delta'));
  };
  first.addEventListener('input',render);second.addEventListener('input',render);
  return {open:()=>{
    const today=new Date().toISOString().slice(0,7);
    const [year,month]=today.split('-').map(Number);
    first.value=year+'-'+String(month===1?12:month-1).padStart(2,'0');
    if(month===1)first.value=(year-1)+'-12';
    second.value=today;render();dialog.showModal();
  },render};
}
