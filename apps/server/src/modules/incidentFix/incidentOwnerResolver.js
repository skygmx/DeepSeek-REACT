export function createIncidentOwnerResolver({ defaultOwner }) {
  function resolve({ context, plan }) {
    return (
      plan?.owner ??
      context?.error?.owner ??
      context?.error?.serviceOwner ??
      defaultOwner ??
      null
    )
  }

  return {
    resolve,
  }
}
