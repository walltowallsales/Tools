 'use strict';
function cents(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.round(n*100):null}
function orderFinancials(orders){const totals=new Map();let missingOrders=0;for(const o of orders){const amount=cents(o.total_amount),shipping=cents(o.total_shipping),currency=String(o.currency_code||'').trim().toUpperCase();if(amount===null||shipping===null||!/^[A-Z]{3}$/.test(currency)){missingOrders++;continue}totals.set(currency,(totals.get(currency)||0)+amount-shipping)}return {totals:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,amountCents])=>({currency,amountCents})),missingOrders,orderCount:orders.length}}
module.exports={orderFinancials};
