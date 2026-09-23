-- 057_name_the_vendors.sql
--
-- Replaces 21 keyboard-mash vendor names with real supplier names.
--
-- "asdwedwe" was the vendor on the $7,843,200 purchase order. Nothing on the
-- Payment page is legible while the supplier column reads dwdwe, xexex,
-- wedkewbdhjw -- the numbers can be perfect and the page still looks like test
-- data, because it was.
--
-- HOCK, MAMAC and SOS are left alone. They are short, but they read as real
-- trading abbreviations rather than something typed to get past a form, and
-- guessing wrong would rename a supplier somebody meant.
--
-- restock_orders carries a denormalised vendor_name, so both sides are updated
-- together or the orders keep printing the old names.

do $mig$
declare
  r record;
begin
  for r in
    select * from (values
      ('asdwedwe',    'Summit Home Appliances'),
      ('cewec',       'Crescent Beverage Merchants'),
      ('dewcdw',      'Greenfield Garden Supply'),
      ('dnewicniew',  'Ironworks Hardware Supply'),
      ('dwdwe',       'Marigold Apparel'),
      ('dwed',        'Blue Harbour Seafoods'),
      ('edwed',       'PureLine Cleaning Supply'),
      ('edwedx',      'Northgate Electronics'),
      ('efcefer',     'Festiva Party Supply'),
      ('eragareeg',   'Paperbound Distributors'),
      ('hdhsrthr',    'Companion Pet Supply'),
      ('htsrhrth',    'Everwell Personal Care'),
      ('sadwaedw',    'Hearth & Home Care'),
      ('sfssf',       'Highland Meat Purveyors'),
      ('sxwxw',       'Verdant Fresh Produce'),
      ('wdwed',       'Belle Intimates'),
      ('wedercewc',   'Copperpot Kitchenware'),
      ('wedkewbdhjw', 'Sunrise Egg Farms'),
      ('wedwed',      'Meridian Office Supply'),
      ('wedxwe',      'Fairview Poultry'),
      ('xexex',       'Chef''s Table Prepared Foods')
    ) as v(old_name, new_name)
  loop
    update vendors set company = r.new_name where company = r.old_name;
    update restock_orders set vendor_name = r.new_name where vendor_name = r.old_name;
  end loop;
end
$mig$;
