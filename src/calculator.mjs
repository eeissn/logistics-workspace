import { margin } from './domain.mjs';

function roundPrice(amount) {
  if (amount < 1000) return Math.round(amount);
  const base = Math.floor(amount / 1000) * 1000;
  const remainder = Math.round((amount - base) * 100) / 100;
  return base + (remainder < 500 ? 0 : remainder < 700 ? 500 : 1000);
}

export function vatPrice(base, rate) {
  const exact = Math.round((parseFloat(base) || 0) * (rate === 5 ? 1.05 : 1.22) * 100) / 100;
  return {exact, rounded:roundPrice(exact)};
}

export function mountCalculator(dialog) {
  const form = dialog.querySelector('form');
  const inputs = form.elements;
  const display = new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2});
  const format = number => display.format(number) + ' ₽';
  const status = dialog.querySelector('[role=status]');
  let generation = 0;
  const recalculate = () => {
    const result = margin(inputs.income.value, inputs.incomeTax.value, inputs.cost.value, inputs.costTax.value);
    for (const output of dialog.querySelectorAll('[data-margin]')) {
      output.textContent = format(Math.round(result[output.dataset.margin]));
    }
    for (const output of dialog.querySelectorAll('[data-vat]')) {
      const {exact, rounded} = vatPrice(inputs.base.value, Number(output.dataset.vat));
      output.value = format(rounded);
      output.nextElementSibling.textContent = exact === rounded ? '' : 'Точно ' + format(exact);
      output.parentElement.querySelector('[data-copy]').dataset.copy = rounded;
    }
  };
  form.addEventListener('input', recalculate);
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const started = generation;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      if (started === generation && dialog.open) status.textContent = 'Сумма скопирована.';
    } catch {
      if (started === generation && dialog.open) status.textContent = 'Не удалось скопировать. Выделите сумму вручную.';
    }
  });
  return {
    open() { recalculate(); dialog.showModal(); },
    reset() { generation++; form.reset(); status.textContent = ''; recalculate(); },
  };
}
