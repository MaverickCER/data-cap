import { buildData } from "@maverickcer/data-cap"
import { productFields } from "shared-schema-package"

export const productCapability = buildData({ fields: productFields })
