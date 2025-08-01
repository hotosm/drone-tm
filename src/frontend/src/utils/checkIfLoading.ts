import { RootState } from '@Store/index';

export default function checkIfLoading(
  store: RootState,
  actionsToCheck: string[],
) {
  return store.loader.actions.some((action: any) =>
    actionsToCheck.includes(action),
  );
}
