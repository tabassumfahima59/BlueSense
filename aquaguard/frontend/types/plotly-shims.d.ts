declare module "react-plotly.js/factory" {
  import type { ComponentType } from "react";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory: (plotly: any) => ComponentType<any>;
  export default factory;
}

declare module "plotly.js-dist-min" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Plotly: any;
  export default Plotly;
}
