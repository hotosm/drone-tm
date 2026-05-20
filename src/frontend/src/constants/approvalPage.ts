/* eslint-disable import/prefer-default-export */
import { m } from "@/paraglide/messages";

export const getTabOptions = () => [
  { id: 1, label: m.regulator_tab_about(), value: "about" },
  { id: 2, label: m.regulator_tab_instruction(), value: "instruction" },
];
