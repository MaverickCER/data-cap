import { buildData, documentData } from "@maverickcer/data-cap"
import { userFields } from "@schemas/user.js"

export const userCapability = buildData({ fields: userFields })

documentData(
  { fields: userFields },
  {
    fields: {
      name: { description: "The user's display name." },
      email: { description: "The user's email address." },
    },
  },
)
