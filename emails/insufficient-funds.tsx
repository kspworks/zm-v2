import {
  InsufficientFundsEmail,
  type ShortageSection,
} from "~/server/mail/templates";

const sections: ShortageSection[] = [
  {
    accountName: "Monobank",
    date: "2026-10-03",
    plannedAmount: 1250000,
    currentBalance: 430050,
    shortage: 819950,
    currencySign: "₴",
  },
  {
    accountName: "Revolut",
    date: "2026-10-11",
    plannedAmount: 42000,
    currentBalance: 39900,
    shortage: 2100,
    currencySign: "€",
  },
];

const Preview = () => (
  <InsufficientFundsEmail locale="uk" sections={sections} />
);

export default Preview;
